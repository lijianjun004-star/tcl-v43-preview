-- Additive migration. The pilot enrollment table must already exist.
begin;

create table public.tcl_r24_sync_v1_device_grants (
  code_digest text collate "C" primary key check (code_digest ~ '^[0-9a-f]{64}$'),
  enrollment_id text collate "C" not null references public.tcl_r24_sync_v1_enrollments(id),
  activation_expires_at timestamptz not null,
  used_at timestamptz,
  device_digest text collate "C" unique check (device_digest ~ '^[0-9a-f]{64}$'),
  device_expires_at timestamptz,
  revoked_at timestamptz,
  check (
    (used_at is null and device_digest is null and device_expires_at is null) or
    (used_at is not null and device_digest is not null and device_expires_at is not null
      and used_at < activation_expires_at
      and device_expires_at > used_at
      and device_expires_at <= used_at + interval '2160 hours')
  )
);

create index tcl_r24_sync_v1_device_grants_enrollment
on public.tcl_r24_sync_v1_device_grants (enrollment_id);

alter table public.tcl_r24_sync_v1_device_grants enable row level security;
revoke all privileges on table public.tcl_r24_sync_v1_device_grants
from public, anon, authenticated, service_role;
grant select on table public.tcl_r24_sync_v1_device_grants to service_role;
grant update (used_at, device_digest, device_expires_at)
on table public.tcl_r24_sync_v1_device_grants to service_role;

commit;
