-- Optional team-wide scoring grant for an installed shared queue.
-- Run once, as the owner of the pilot tables, after schema-repository-scoring-shared.sql.
-- Installation leaves every team closed. An administrator opens a whole team with
--   insert into r24_repo_scoring.open_grants(team_id) values ('r24-pilot');
-- and closes it again with
--   delete from r24_repo_scoring.open_grants where team_id = 'r24-pilot';
-- Exact allowlist grants keep working either way and take precedence for new jobs.
-- Closing a team invalidates its unprocessed jobs; reopening issues a new grant_id
-- and cannot revive them, matching the allowlist's revocation rule.
-- Re-running this file fails on the existing table without changing anything.
do $open$
begin
create table r24_repo_scoring.open_grants (
  team_id text collate "C" primary key,
  grant_id uuid not null unique default pg_catalog.gen_random_uuid()
);
alter table r24_repo_scoring.open_grants enable row level security;

-- A job stays authorized while the grant it was queued under still exists for
-- the same submission scope: an exact allowlist row or its team's open grant.
create function r24_repo_scoring.grant_active(p_grant_id uuid, p_team_id text, p_assignment_id text, p_anchor_id text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists(select 1 from r24_repo_scoring.allowlist g
      where g.grant_id=p_grant_id and g.team_id=p_team_id
        and g.assignment_id=p_assignment_id and g.anchor_id=p_anchor_id)
    or exists(select 1 from r24_repo_scoring.open_grants o
      where o.grant_id=p_grant_id and o.team_id=p_team_id);
$$;

create or replace function r24_repo_scoring.enqueue() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_grant uuid;
begin
  select g.grant_id into v_grant from r24_repo_scoring.allowlist g
    where g.team_id = new.team_id and g.assignment_id = new.assignment_id
      and g.anchor_id = new.anchor_id;
  if v_grant is null then
    select o.grant_id into v_grant from r24_repo_scoring.open_grants o where o.team_id = new.team_id;
  end if;
  if v_grant is not null then
    insert into r24_repo_scoring.jobs(job_id, grant_id) values (new.id, v_grant)
      on conflict (job_id) do nothing;
  end if;
  return new;
end
$$;

create or replace function r24_repo_scoring.claim(p_lease uuid) returns jsonb
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
    where j.state in ('ready','scored') and (j.lease_until is null or j.lease_until <= clock_timestamp())
      and r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)
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

create or replace function r24_repo_scoring.start_attempt(p_job_id text, p_lease uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  update r24_repo_scoring.jobs j set state='attempting'
    from public.tcl_r24_sync_v1_submissions s
    where s.id=j.job_id and r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)
      and j.job_id=p_job_id and j.lease_id=p_lease
      and j.state='ready' and j.lease_until>clock_timestamp() and (s.payload->'evaluation') is null;
  return found;
end
$$;

create or replace function r24_repo_scoring.save_result(p_job_id text,p_lease uuid,p_result jsonb,p_receipt jsonb)
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
    from public.tcl_r24_sync_v1_submissions s
    where s.id=j.job_id and r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)
      and j.job_id=p_job_id and j.lease_id=p_lease and
      ((j.state='attempting' and p_receipt->>'origin'='openai_review') or
       (j.state='ready' and j.lease_until>clock_timestamp() and jsonb_typeof(s.payload->'evaluation')='object'
        and p_receipt->>'origin'='submission'));
  return found;
end
$$;

create or replace function r24_repo_scoring.read_repository_reviews(
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
      when r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)
        and j.state='ready' then jsonb_build_object('status','waiting')
      when r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)
        and j.state='attempting' and j.lease_until > now()
        then jsonb_build_object('status','processing')
      else jsonb_build_object('status','needs_attention')
    end
  from public.tcl_r24_sync_v1_submissions s
  join public.tcl_r24_sync_v1_assignments a on a.id=s.assignment_id and a.team_id=s.team_id
  join r24_repo_scoring.jobs j on j.job_id=s.id
  where s.team_id=p_team_id and s.assignment_id=p_assignment_id and s.id=any(p_ids)
    and cardinality(p_ids) between 1 and 20
    and ((p_viewer_role='operator' and a.payload->>'operatorId'=p_viewer_id)
      or (p_viewer_role='anchor' and s.anchor_id=p_viewer_id
        and (a.payload->'recipients'='[]'::jsonb or
          a.payload->'recipients' @> jsonb_build_array(jsonb_build_object('id',p_viewer_id)))))
    and (s.payload->'evaluation' is null or j.receipt->>'origin'='openai_review');
end
$$;

create or replace function r24_repo_scoring.can_auto_score(p_team_id text,p_assignment_id text,p_anchor_id text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform r24_repo_scoring.require_service();
  return exists(select 1 from r24_repo_scoring.allowlist g
      where g.team_id=p_team_id and g.assignment_id=p_assignment_id and g.anchor_id=p_anchor_id)
    or exists(select 1 from r24_repo_scoring.open_grants o where o.team_id=p_team_id);
end
$$;

-- Same privilege shape as the installer: the runtime only calls its entry points.
revoke all on table r24_repo_scoring.open_grants from public, anon, authenticated, service_role;
revoke all on function r24_repo_scoring.grant_active(uuid,text,text,text) from public, anon, authenticated, service_role;
end
$open$;
