-- Additive R24 pilot storage. Any table/index collision aborts the whole transaction.
begin;

create table public.tcl_r24_sync_v1_enrollments (
  id text collate "C" primary key check (id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  team_id text collate "C" not null check (team_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  display_name text not null check (char_length(display_name) between 1 and 40 and btrim(display_name) = display_name),
  role text not null check (role in ('anchor', 'operator')),
  active boolean not null default false
);

create table public.tcl_r24_sync_v1_assignments (
  id text collate "C" primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  team_id text collate "C" not null check (team_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ?& array['id', 'teamId']
    and payload->>'id' = id and payload->>'teamId' = team_id
  )
);

create table public.tcl_r24_sync_v1_submissions (
  id text collate "C" primary key check (id ~ '^[0-9a-f]{64}$'),
  team_id text collate "C" not null check (team_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  assignment_id text collate "C" not null references public.tcl_r24_sync_v1_assignments(id),
  anchor_id text collate "C" not null check (anchor_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  submitted_at timestamptz not null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ?& array['id', 'teamId', 'assignmentId', 'anchorId']
    and payload->>'id' = id and payload->>'teamId' = team_id
    and payload->>'assignmentId' = assignment_id and payload->>'anchorId' = anchor_id
  )
);

create index tcl_r24_sync_v1_enrollments_scope on public.tcl_r24_sync_v1_enrollments (team_id, role, active, id);
create index tcl_r24_sync_v1_assignments_scope on public.tcl_r24_sync_v1_assignments (team_id, id);
create index tcl_r24_sync_v1_submissions_assignment on public.tcl_r24_sync_v1_submissions (assignment_id, team_id, id);
create index tcl_r24_sync_v1_submissions_anchor on public.tcl_r24_sync_v1_submissions (team_id, anchor_id, id);

alter table public.tcl_r24_sync_v1_enrollments enable row level security;
alter table public.tcl_r24_sync_v1_assignments enable row level security;
alter table public.tcl_r24_sync_v1_submissions enable row level security;

revoke all privileges on table public.tcl_r24_sync_v1_enrollments, public.tcl_r24_sync_v1_assignments, public.tcl_r24_sync_v1_submissions
from public, anon, authenticated, service_role;

grant select on table public.tcl_r24_sync_v1_enrollments to service_role;
grant select, insert on table public.tcl_r24_sync_v1_assignments, public.tcl_r24_sync_v1_submissions to service_role;

commit;
