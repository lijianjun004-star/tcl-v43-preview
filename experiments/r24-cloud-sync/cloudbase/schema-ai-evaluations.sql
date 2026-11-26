-- Additive pilot-only predeployment script. Apply separately with administrator approval.
begin;

create table if not exists public.tcl_r24_sync_v1_evaluations (
  id text collate "C" primary key check (id ~ '^[0-9a-f]{64}$'),
  assignment_id text collate "C" not null references public.tcl_r24_sync_v1_assignments(id),
  team_id text collate "C" not null,
  anchor_id text collate "C" not null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ?& array['id', 'teamId', 'anchorId', 'assignmentId', 'evaluation']
    and (payload->>'id') is not distinct from id and (payload->>'teamId') is not distinct from team_id
    and (payload->>'anchorId') is not distinct from anchor_id and (payload->>'assignmentId') is not distinct from assignment_id
    and jsonb_typeof(payload->'evaluation') = 'object'
  )
);

alter table public.tcl_r24_sync_v1_evaluations enable row level security;
revoke all privileges on table public.tcl_r24_sync_v1_evaluations from public, anon, authenticated, service_role;
grant select, insert on table public.tcl_r24_sync_v1_evaluations to service_role;

commit;
