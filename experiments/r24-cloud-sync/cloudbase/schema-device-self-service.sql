-- Additive R24-only migration. Existing activation codes become administrator-issued.
begin;

alter table public.tcl_r24_sync_v1_device_grants
  add column source text not null default 'admin' check (source in ('admin', 'self'));

create unique index tcl_r24_sync_v1_one_unused_self_code
on public.tcl_r24_sync_v1_device_grants (enrollment_id)
where source = 'self' and used_at is null and revoked_at is null;

create function public.tcl_r24_sync_v1_issue_device_code(
  p_issuer_device_digest text,
  p_code_digest text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_enrollment_id text;
  v_session public.tcl_r24_sync_v1_device_grants%rowtype;
  v_now timestamptz;
  v_expiry timestamptz;
begin
  if p_issuer_device_digest is null or p_issuer_device_digest !~ '^[0-9a-f]{64}$'
     or p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('expiresAt', null);
  end if;

  -- Serialize code replacement for the same enrollment, even across different devices.
  select e.id into v_enrollment_id
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

  v_expiry := v_now + interval '2160 hours';
  update public.tcl_r24_sync_v1_device_grants
  set revoked_at = v_now
  where enrollment_id = v_enrollment_id and source = 'self'
    and used_at is null and revoked_at is null;

  insert into public.tcl_r24_sync_v1_device_grants
    (code_digest, enrollment_id, activation_expires_at, source)
  values (p_code_digest, v_enrollment_id, v_expiry, 'self');

  return pg_catalog.jsonb_build_object('expiresAt', v_expiry);
end;
$$;

revoke all on function public.tcl_r24_sync_v1_issue_device_code(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_issue_device_code(text, text)
to service_role;

commit;
