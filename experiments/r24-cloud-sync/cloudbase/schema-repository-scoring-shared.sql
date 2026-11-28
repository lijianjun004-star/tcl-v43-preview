-- Alternative to the two direct-PostgreSQL migrations on a fresh shared pilot.
-- Execute this single transactional statement as the owner of the pilot tables.
-- Existing queue objects cause installation to fail without overwriting data.
do $install$
begin
create schema r24_repo_scoring;
revoke all on schema r24_repo_scoring from public, anon, authenticated, service_role;

-- SECURITY DEFINER changes current_user to the function owner. The explicit
-- session role (or the login role if none was set) still identifies the caller.
-- PostgREST's signed JWT role must also agree whenever claims are present.
create function r24_repo_scoring.require_service() returns void
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare
  caller text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if caller is distinct from 'service_role'
     or (claims is not null and claims->>'role' is distinct from 'service_role') then
    raise exception using errcode='42501', message='scoring service identity required';
  end if;
end
$$;

-- Exact staff/assignment grants, deliberately empty on installation. Re-enabling
-- after revocation issues a new grant_id and cannot revive old, undispatched work.
create table r24_repo_scoring.allowlist (
  team_id text collate "C" not null,
  assignment_id text collate "C" not null,
  anchor_id text collate "C" not null,
  grant_id uuid not null unique default pg_catalog.gen_random_uuid(),
  primary key (team_id, assignment_id, anchor_id)
);
create table r24_repo_scoring.jobs (
  job_id text collate "C" primary key references public.tcl_r24_sync_v1_submissions(id),
  grant_id uuid not null,
  queued_at timestamptz not null default pg_catalog.clock_timestamp(),
  state text not null default 'ready' check (state in ('ready','attempting','scored','archived','held')),
  lease_id uuid,
  lease_until timestamptz,
  result jsonb,
  receipt jsonb,
  hold_reason text
);
create index repository_scoring_dispatch on r24_repo_scoring.jobs(queued_at, job_id)
  where state in ('ready', 'scored');
alter table r24_repo_scoring.allowlist enable row level security;
alter table r24_repo_scoring.jobs enable row level security;

-- Nothing in the trigger performs I/O or sends material to a worker. INSERT
-- on the immutable source table and its outbox entry commit or roll back together.
create function r24_repo_scoring.enqueue() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into r24_repo_scoring.jobs(job_id, grant_id)
    select new.id, g.grant_id from r24_repo_scoring.allowlist g
    where g.team_id = new.team_id and g.assignment_id = new.assignment_id
      and g.anchor_id = new.anchor_id
    on conflict (job_id) do nothing;
  return new;
end
$$;
create trigger r24_repository_review_enqueue after insert on public.tcl_r24_sync_v1_submissions
  for each row execute function r24_repo_scoring.enqueue();

create function r24_repo_scoring.claim(p_lease uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  job r24_repo_scoring.jobs%rowtype;
  src jsonb;
  questions jsonb;
  turns jsonb;
  items jsonb;
  evaluation jsonb;
  prior jsonb;
begin
  perform r24_repo_scoring.require_service();
  if p_lease is null then return null; end if;
  select j.* into job from r24_repo_scoring.jobs j
    join public.tcl_r24_sync_v1_submissions s on s.id=j.job_id
    join r24_repo_scoring.allowlist g on g.grant_id=j.grant_id and g.team_id=s.team_id
      and g.assignment_id=s.assignment_id and g.anchor_id=s.anchor_id
    where j.state in ('ready','scored') and (j.lease_until is null or j.lease_until <= clock_timestamp())
    order by j.queued_at, j.job_id limit 1 for update of j skip locked;
  if not found then return null; end if;
  update r24_repo_scoring.jobs set lease_id=p_lease, lease_until=clock_timestamp()+interval '5 minutes'
    where job_id=job.job_id;
  if job.state = 'scored' then
    return jsonb_build_object('jobId',job.job_id,'state','scored','receipt',job.receipt);
  end if;

  select s.payload, a.payload #> '{assignment,questions}' into src, questions
    from public.tcl_r24_sync_v1_submissions s join public.tcl_r24_sync_v1_assignments a
      on a.id=s.assignment_id and a.team_id=s.team_id
    where s.id=job.job_id and s.payload->>'snapshotSha256' = a.payload #>> '{assignment,snapshotSha256}';
  turns=src->'turns';
  items='[]'::jsonb;
  if jsonb_typeof(questions)='array' and jsonb_typeof(turns)='array' then
    if jsonb_array_length(questions) between 1 and 15 and jsonb_array_length(questions)=jsonb_array_length(turns) then
      select case when count(*)=jsonb_array_length(questions)
        then jsonb_agg(jsonb_build_object('question',q.obj->'question','referenceAnswer',q.obj->'answer',
                              'keyPoints',q.obj->'keyPoints','answerText',t.obj->'answer') order by q.pos)
        else '[]'::jsonb end into items
        from jsonb_array_elements(questions) with ordinality as q(obj,pos)
        join jsonb_array_elements(turns) with ordinality as t(obj,pos) on t.pos=q.pos
        where q.obj->>'id'=t.obj->>'questionId';
    end if;
  end if;
  evaluation=src->'evaluation';
  if jsonb_typeof(evaluation)='object' then
    prior=jsonb_build_object('overallScore',evaluation->'overallScore','grade',evaluation->'grade',
      'items',evaluation->'items','model',evaluation->'model','source',evaluation->'source');
  end if;
  return jsonb_build_object('jobId',job.job_id,'state','ready','items',items,'existingEvaluation',prior);
end
$$;

-- Mark the potentially billable attempt *before* each outbound request. An
-- expired 'attempting' lease is ambiguous and is never claimed for another call.
create function r24_repo_scoring.start_attempt(p_job_id text, p_lease uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  update r24_repo_scoring.jobs j set state='attempting'
    from public.tcl_r24_sync_v1_submissions s, r24_repo_scoring.allowlist g
    where s.id=j.job_id and g.grant_id=j.grant_id and g.team_id=s.team_id
      and g.assignment_id=s.assignment_id and g.anchor_id=s.anchor_id and j.job_id=p_job_id and j.lease_id=p_lease
      and j.state='ready' and j.lease_until>clock_timestamp() and (s.payload->'evaluation') is null;
  return found;
end
$$;

create function r24_repo_scoring.save_result(p_job_id text,p_lease uuid,p_result jsonb,p_receipt jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  if (jsonb_typeof(p_result)='object' and octet_length(p_result::text)<=262144
    and jsonb_typeof(p_receipt)='object' and octet_length(p_receipt::text)<=32768
    and p_receipt->'schemaVersion'='1'::jsonb and p_receipt->>'jobId'=p_job_id
    and p_receipt->>'reviewStatus'='pending_review'
    and jsonb_typeof(p_receipt->'items')='array') is not true then return false; end if;
  update r24_repo_scoring.jobs j set state='scored', result=p_result, receipt=p_receipt,
    lease_until=clock_timestamp()+interval '5 minutes'
    from public.tcl_r24_sync_v1_submissions s, r24_repo_scoring.allowlist g
    where s.id=j.job_id and g.grant_id=j.grant_id and g.team_id=s.team_id
      and g.assignment_id=s.assignment_id and g.anchor_id=s.anchor_id and j.job_id=p_job_id and j.lease_id=p_lease and
      ((j.state='attempting' and p_receipt->>'origin'='openai_review') or
       (j.state='ready' and j.lease_until>clock_timestamp() and jsonb_typeof(s.payload->'evaluation')='object'
        and p_receipt->>'origin'='submission'));
  return found;
end
$$;

create function r24_repo_scoring.ack(p_job_id text,p_lease uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  update r24_repo_scoring.jobs set state='archived', lease_id=null, lease_until=null
    where job_id=p_job_id and lease_id=p_lease and state='scored';
  return found;
end
$$;

create function r24_repo_scoring.hold(p_job_id text,p_lease uuid,p_reason text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  if p_reason is null or p_reason !~ '^[A-Za-z0-9_.-]{1,96}$' then return false; end if;
  update r24_repo_scoring.jobs set state='held',hold_reason=p_reason,lease_id=null,lease_until=null
    where job_id=p_job_id and lease_id=p_lease and state in ('ready','attempting','scored');
  return found;
end
$$;

-- The web API authenticates the viewer and supplies these parameters. Users
-- cannot invoke the same projection by supplying another anchor's ID to RPC.
create function r24_repo_scoring.read_repository_reviews(
  p_assignment_id text, p_team_id text, p_viewer_id text, p_viewer_role text, p_ids text[]
) returns table (id text, repository_review jsonb)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  return query
    select s.id,
    case
      when j.state in ('scored','archived') and j.receipt->>'origin' = 'openai_review'
        and j.result->>'source' = 'openai_offline' and jsonb_typeof(j.result->'items') = 'array'
      then jsonb_build_object('status','pending_review','evaluation',jsonb_build_object(
        'source','openai_offline','model',j.result->'model','degraded',false,
        'overallScore',j.result->'overallScore','grade',j.result->'grade',
        'items',(select jsonb_agg(jsonb_build_object('questionIndex',item->'questionIndex',
           'score',item->'score','matchedPoints',item->'matchedPoints','missedPoints',item->'missedPoints',
           'comment',item->'comment','suggestedScript',item->'suggestedScript') order by n)
           from jsonb_array_elements(j.result->'items') with ordinality as detail(item,n))))
      when g.grant_id is not null and j.state='ready' then jsonb_build_object('status','waiting')
      when g.grant_id is not null and j.state='attempting' and j.lease_until > now()
        then jsonb_build_object('status','processing')
      else jsonb_build_object('status','needs_attention')
    end
  from public.tcl_r24_sync_v1_submissions s
  join public.tcl_r24_sync_v1_assignments a on a.id=s.assignment_id and a.team_id=s.team_id
  join r24_repo_scoring.jobs j on j.job_id=s.id
  left join r24_repo_scoring.allowlist g on g.grant_id=j.grant_id and g.team_id=s.team_id
    and g.anchor_id=s.anchor_id and g.assignment_id=s.assignment_id
  where s.team_id=p_team_id and s.assignment_id=p_assignment_id and s.id=any(p_ids)
    and cardinality(p_ids) between 1 and 20
    and ((p_viewer_role='operator' and a.payload->>'operatorId'=p_viewer_id)
      or (p_viewer_role='anchor' and s.anchor_id=p_viewer_id
        and (a.payload->'recipients'='[]'::jsonb or
          a.payload->'recipients' @> jsonb_build_array(jsonb_build_object('id',p_viewer_id)))))
    and (s.payload->'evaluation' is null or j.receipt->>'origin'='openai_review');
end
$$;

create function r24_repo_scoring.can_auto_score(p_team_id text,p_assignment_id text,p_anchor_id text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  return exists(select 1 from r24_repo_scoring.allowlist g
    where g.team_id=p_team_id and g.assignment_id=p_assignment_id and g.anchor_id=p_anchor_id);
end
$$;

-- Keep the private schema free of inherited project-default grants. The
-- runtime receives only the functions it calls and cannot read or write tables.
revoke all on all tables in schema r24_repo_scoring from public, anon, authenticated, service_role;
revoke all on all functions in schema r24_repo_scoring from public, anon, authenticated, service_role;
grant usage on schema r24_repo_scoring to service_role;
grant execute on function r24_repo_scoring.require_service(),
  r24_repo_scoring.claim(uuid), r24_repo_scoring.start_attempt(text,uuid),
  r24_repo_scoring.save_result(text,uuid,jsonb,jsonb), r24_repo_scoring.ack(text,uuid),
  r24_repo_scoring.hold(text,uuid,text), r24_repo_scoring.can_auto_score(text,text,text),
  r24_repo_scoring.read_repository_reviews(text,text,text,text,text[]) to service_role;

-- PostgREST exposes these invoker functions. The private entry points check
-- the caller in their bodies even if the gateway skips function EXECUTE checks.

create function public.tcl_r24_sync_v1_worker_claim(p_lease uuid)
returns table(value jsonb)
language sql security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.claim(p_lease);
$$;
revoke all on function public.tcl_r24_sync_v1_worker_claim(uuid) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_worker_claim(uuid) to service_role;

create function public.tcl_r24_sync_v1_worker_start_attempt(p_job_id text, p_lease uuid)
returns table(value boolean)
language sql security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.start_attempt(p_job_id, p_lease);
$$;
revoke all on function public.tcl_r24_sync_v1_worker_start_attempt(text,uuid) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_worker_start_attempt(text,uuid) to service_role;

create function public.tcl_r24_sync_v1_worker_save_result(p_job_id text, p_lease uuid, p_result jsonb, p_receipt jsonb)
returns table(value boolean)
language sql security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.save_result(p_job_id, p_lease, p_result, p_receipt);
$$;
revoke all on function public.tcl_r24_sync_v1_worker_save_result(text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_worker_save_result(text,uuid,jsonb,jsonb) to service_role;

create function public.tcl_r24_sync_v1_worker_ack(p_job_id text, p_lease uuid)
returns table(value boolean)
language sql security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.ack(p_job_id, p_lease);
$$;
revoke all on function public.tcl_r24_sync_v1_worker_ack(text,uuid) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_worker_ack(text,uuid) to service_role;

create function public.tcl_r24_sync_v1_worker_hold(p_job_id text, p_lease uuid, p_reason text)
returns table(value boolean)
language sql security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.hold(p_job_id, p_lease, p_reason);
$$;
revoke all on function public.tcl_r24_sync_v1_worker_hold(text,uuid,text) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_worker_hold(text,uuid,text) to service_role;

create function public.tcl_r24_sync_v1_can_auto_score(p_team_id text, p_assignment_id text, p_anchor_id text)
returns table(value boolean)
language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select r24_repo_scoring.can_auto_score(p_team_id, p_assignment_id, p_anchor_id);
$$;
revoke all on function public.tcl_r24_sync_v1_can_auto_score(text,text,text) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_can_auto_score(text,text,text) to service_role;

create function public.tcl_r24_sync_v1_read_repository_reviews(p_assignment_id text, p_team_id text, p_viewer_id text, p_viewer_role text, p_ids text[])
returns table(id text, repository_review jsonb)
language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select * from r24_repo_scoring.read_repository_reviews(p_assignment_id, p_team_id, p_viewer_id, p_viewer_role, p_ids);
$$;
revoke all on function public.tcl_r24_sync_v1_read_repository_reviews(text,text,text,text,text[]) from public, anon, authenticated;
grant execute on function public.tcl_r24_sync_v1_read_repository_reviews(text,text,text,text,text[]) to service_role;
end
$install$;
