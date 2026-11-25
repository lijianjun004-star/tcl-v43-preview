-- R24 pilot only. Keep the original IDs and all existing assignment/submission relationships.
begin;

create function public.tcl_r24_sync_v1_canonical_name(input_name text)
returns text language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select btrim(normalize(input_name, NFKC),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

alter table public.tcl_r24_sync_v1_enrollments
  add column enroll_mode text not null default 'admin' check (enroll_mode in ('admin','auto-approved')),
  add column enrolled_at timestamptz,
  add column reset_allowed_at timestamptz,
  add column name_key text collate "C" generated always as
    (public.tcl_r24_sync_v1_canonical_name(display_name)) stored;

-- A nonunique index makes existing canonical-name collisions explicit instead of
-- silently choosing an account or failing the entire migration on a historical name.
create index tcl_r24_sync_v1_enrollments_name on public.tcl_r24_sync_v1_enrollments (name_key);
alter table public.tcl_r24_sync_v1_device_grants
  add column device_id uuid not null default pg_catalog.gen_random_uuid();

create table public.tcl_r24_sync_v1_device_attempts (
  client_key text not null check (client_key ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('auto-enroll','activate')),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (client_key, action)
);
create index tcl_r24_sync_v1_device_attempts_window on public.tcl_r24_sync_v1_device_attempts(window_start);
alter table public.tcl_r24_sync_v1_device_attempts enable row level security;
revoke all on table public.tcl_r24_sync_v1_device_attempts from public, anon, authenticated, service_role;

create function public.tcl_r24_sync_v1_count_device_attempt(
  p_client_key text,
  p_action text,
  p_shared boolean
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz;
  v_count integer;
  v_limit integer;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$'
     or p_action is null or p_action not in ('auto-enroll','activate')
     or p_shared is null then
    return jsonb_build_object('allowed', false, 'retryAfter', 300);
  end if;
  v_window := date_bin(interval '5 minutes', v_now, '2000-01-01T00:00:00Z'::timestamptz);
  v_limit := case when p_shared then 10 when p_action = 'auto-enroll' then 12 else 24 end;
  insert into public.tcl_r24_sync_v1_device_attempts as bucket(client_key, action, window_start, attempts)
    values (p_client_key, p_action, v_window, 1)
    on conflict (client_key, action) do update
      set window_start = excluded.window_start,
          attempts = case when bucket.window_start = excluded.window_start
            then least(bucket.attempts + 1, v_limit + 1) else 1 end
      where bucket.window_start <= excluded.window_start
    returning attempts into v_count;
  return jsonb_build_object(
    'allowed', coalesce(v_count <= v_limit, false),
    'retryAfter', greatest(1, ceil(extract(epoch from (v_window + interval '5 minutes' - v_now)))::integer)
  );
end;
$$;

create function public.tcl_r24_sync_v1_auto_enroll_device(
  p_name text,
  p_role text,
  p_device_digest text,
  p_internal_digest text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_account public.tcl_r24_sync_v1_enrollments%rowtype;
  v_device public.tcl_r24_sync_v1_device_grants%rowtype;
  v_now timestamptz;
  v_matches integer;
  v_id uuid;
begin
  if p_name is null or char_length(p_name) not between 2 and 30
     or p_name <> public.tcl_r24_sync_v1_canonical_name(p_name)
     or p_name ~ '[[:cntrl:]]'
     or p_role is null or p_role not in ('anchor','operator')
     or p_device_digest is null or p_device_digest !~ '^[0-9a-f]{64}$'
     or p_internal_digest is null or p_internal_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid');
  end if;

  -- Equal canonical names serialize under one transaction lock. A hash collision
  -- can only serialize two unrelated requests, never merge their identity rows.
  perform pg_advisory_xact_lock(hashtextextended('tcl_r24_sync_v1_name:' || p_name, 0));
  select count(*) into v_matches from (
    select 1 from public.tcl_r24_sync_v1_enrollments
    where name_key = p_name limit 2
  ) names;
  if v_matches > 1 then
    return jsonb_build_object('status','ambiguous');
  end if;
  v_now := clock_timestamp();

  if v_matches = 1 then
    select * into v_account from public.tcl_r24_sync_v1_enrollments
      where name_key = p_name for update;
    if v_account.team_id <> 'r24-pilot' or not v_account.active then
      return jsonb_build_object('status','unavailable');
    end if;
    select * into v_device from public.tcl_r24_sync_v1_device_grants
      where device_digest = p_device_digest and enrollment_id = v_account.id;
    if found and v_device.used_at is not null and v_device.revoked_at is null
       and v_device.device_expires_at > v_now then
      return jsonb_build_object('status','enrolled','name',v_account.display_name,
        'role',v_account.role,'deviceId',v_device.device_id,'id',v_account.id);
    end if;
    if v_account.reset_allowed_at is null or v_account.role <> p_role then
      return jsonb_build_object('status','exists','registeredRole',v_account.role);
    end if;
  else
    insert into public.tcl_r24_sync_v1_enrollments
      (id,team_id,display_name,role,active,enroll_mode,enrolled_at)
    values ('r24_' || replace(gen_random_uuid()::text,'-',''),'r24-pilot',p_name,p_role,true,'auto-approved',v_now)
    returning * into v_account;
  end if;

  insert into public.tcl_r24_sync_v1_device_grants
    (code_digest,enrollment_id,activation_expires_at,used_at,device_digest,device_expires_at,source)
  values (p_internal_digest,v_account.id,v_now+interval '1 second',v_now,p_device_digest,
    v_now+interval '2160 hours','admin')
  returning device_id into v_id;

  update public.tcl_r24_sync_v1_enrollments set reset_allowed_at = null where id = v_account.id;
  return jsonb_build_object('status','enrolled','name',v_account.display_name,
    'role',v_account.role,'deviceId',v_id,'id',v_account.id);
exception when unique_violation then
  -- The enclosing subtransaction rolls back a newly inserted enrollment if
  -- the bearer digest already belongs to another, expired or revoked device.
  return jsonb_build_object('status','device_conflict');
end;
$$;

create function public.tcl_r24_sync_v1_activate_device(
  p_name text,
  p_role text,
  p_code_digest text,
  p_device_digest text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_grant public.tcl_r24_sync_v1_device_grants%rowtype;
  v_account public.tcl_r24_sync_v1_enrollments%rowtype;
  v_now timestamptz;
begin
  if p_name is null or p_name <> public.tcl_r24_sync_v1_canonical_name(p_name)
     or char_length(p_name) not between 2 and 30 or p_name ~ '[[:cntrl:]]'
     or (p_role is not null and p_role not in ('anchor','operator'))
     or p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$'
     or p_device_digest is null or p_device_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('errorCode','CODE_MISMATCH');
  end if;
  -- Account then grant is the same lock order as issuance and reset.
  select e.* into v_account from public.tcl_r24_sync_v1_enrollments e
    join public.tcl_r24_sync_v1_device_grants g on g.enrollment_id = e.id
    where g.code_digest = p_code_digest and e.active and e.name_key = p_name
    for update of e;
  if not found then
    return jsonb_build_object('errorCode','CODE_MISMATCH');
  end if;
  if p_role is not null and v_account.role <> p_role then
    return jsonb_build_object('errorCode','CODE_MISMATCH','registeredRole',v_account.role);
  end if;
  select * into v_grant from public.tcl_r24_sync_v1_device_grants
    where code_digest = p_code_digest and enrollment_id = v_account.id for update;
  if not found then
    return jsonb_build_object('errorCode','CODE_MISMATCH');
  end if;
  v_now := clock_timestamp();

  if v_grant.used_at is not null then
    -- A transport retry on the same browser may recover the binding result;
    -- another device cannot reuse even a still-valid activation code.
    if v_grant.device_digest is distinct from p_device_digest or v_grant.revoked_at is not null
       or v_grant.device_expires_at <= v_now then
      return jsonb_build_object('errorCode','CODE_USED');
    end if;
  elsif v_grant.revoked_at is not null or v_grant.activation_expires_at <= v_now then
    return jsonb_build_object('errorCode','CODE_EXPIRED');
  else
    update public.tcl_r24_sync_v1_device_grants
      set used_at = v_now, device_digest = p_device_digest,
          device_expires_at = v_now+interval '2160 hours'
      where code_digest = p_code_digest;
  end if;
  return jsonb_build_object('name',v_account.display_name,'role',v_account.role,
    'deviceId',v_grant.device_id,'id',v_account.id);
exception when unique_violation then
  return jsonb_build_object('errorCode','CODE_MISMATCH');
end;
$$;

create function public.tcl_r24_sync_v1_reset_device_binding(p_enrollment_id text)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_now timestamptz;
begin
  perform 1 from public.tcl_r24_sync_v1_enrollments
    where id = p_enrollment_id and team_id = 'r24-pilot' and active for update;
  if not found then
    return jsonb_build_object('reset',false);
  end if;
  v_now := clock_timestamp();
  update public.tcl_r24_sync_v1_device_grants set revoked_at = v_now
    where enrollment_id = p_enrollment_id and revoked_at is null;
  update public.tcl_r24_sync_v1_enrollments set reset_allowed_at = v_now
    where id = p_enrollment_id;
  return jsonb_build_object('reset',true);
end;
$$;

create or replace function public.tcl_r24_sync_v1_issue_device_code(
  p_issuer_device_digest text,
  p_code_digest text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_enrollment_id text;
  v_name text;
  v_role text;
  v_session public.tcl_r24_sync_v1_device_grants%rowtype;
  v_now timestamptz;
  v_expiry timestamptz;
begin
  if p_issuer_device_digest is null or p_issuer_device_digest !~ '^[0-9a-f]{64}$'
     or p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('expiresAt', null);
  end if;

  -- Serialize code replacement for the same enrollment, even across different devices.
  select e.id, e.display_name, e.role into v_enrollment_id, v_name, v_role
  from public.tcl_r24_sync_v1_enrollments e
  join public.tcl_r24_sync_v1_device_grants g on g.enrollment_id = e.id
  where g.device_digest = p_issuer_device_digest and e.active
  for update of e;
  if not found then
    return pg_catalog.jsonb_build_object('expiresAt', null);
  end if;

  -- Recheck the same authenticated device under lock before any code is replaced.
  select g.* into v_session
  from public.tcl_r24_sync_v1_device_grants g
  where g.device_digest = p_issuer_device_digest and g.enrollment_id = v_enrollment_id
  for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_session.used_at is null or v_session.revoked_at is not null
     or v_session.device_expires_at <= v_now or v_session.device_expires_at is null then
    return pg_catalog.jsonb_build_object('expiresAt', null);
  end if;

  v_expiry := v_now + interval '30 minutes';
  update public.tcl_r24_sync_v1_device_grants
  set revoked_at = v_now
  where enrollment_id = v_enrollment_id
    and used_at is null and revoked_at is null;

  insert into public.tcl_r24_sync_v1_device_grants
    (code_digest, enrollment_id, activation_expires_at, source)
  values (p_code_digest, v_enrollment_id, v_expiry, 'self');

  return pg_catalog.jsonb_build_object('expiresAt', v_expiry, 'name', v_name, 'role', v_role);
end;
$$;

revoke all on function public.tcl_r24_sync_v1_count_device_attempt(text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_count_device_attempt(text,text,boolean) to service_role;
revoke all on function public.tcl_r24_sync_v1_auto_enroll_device(text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_auto_enroll_device(text,text,text,text) to service_role;
revoke all on function public.tcl_r24_sync_v1_activate_device(text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_activate_device(text,text,text,text) to service_role;
revoke all on function public.tcl_r24_sync_v1_issue_device_code(text,text) from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_issue_device_code(text,text) to service_role;
revoke all on function public.tcl_r24_sync_v1_reset_device_binding(text) from public, anon, authenticated, service_role;

commit;
