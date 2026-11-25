-- R24-only claim tracking and private per-answer audio. Run once in the pilot.
begin;

create table public.tcl_r24_sync_v1_claims (
  id text collate "C" primary key check (id ~ '^[0-9a-f]{64}$'),
  team_id text collate "C" not null check (team_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  assignment_id text collate "C" not null references public.tcl_r24_sync_v1_assignments(id),
  anchor_id text collate "C" not null references public.tcl_r24_sync_v1_enrollments(id),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array['id', 'teamId', 'assignmentId', 'anchorId', 'anchorName', 'claimedAt']
    and payload->>'id' = id and payload->>'teamId' = team_id
    and payload->>'assignmentId' = assignment_id and payload->>'anchorId' = anchor_id
  ),
  unique (assignment_id, anchor_id)
);
create index tcl_r24_sync_v1_claims_assignment on public.tcl_r24_sync_v1_claims (assignment_id, team_id, id);
create index tcl_r24_sync_v1_claims_anchor on public.tcl_r24_sync_v1_claims (team_id, anchor_id, id);

create table public.tcl_r24_sync_v1_submission_audio (
  id text collate "C" primary key check (id ~ '^[0-9a-f]{64}$'),
  team_id text collate "C" not null check (team_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  assignment_id text collate "C" not null references public.tcl_r24_sync_v1_assignments(id),
  submission_id text collate "C" not null references public.tcl_r24_sync_v1_submissions(id),
  anchor_id text collate "C" not null references public.tcl_r24_sync_v1_enrollments(id),
  question_id text collate "C" not null check (question_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  mime_type text not null check (mime_type in (
    'audio/webm','audio/ogg','audio/mp4','audio/wav','audio/x-wav','audio/mpeg','audio/aac','audio/x-m4a'
  )),
  bytes integer not null check (bytes between 1 and 524288),
  sha256 text collate "C" not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_path text unique not null check (
    object_path = 'submissions/' || submission_id || '/' || id || '.' ||
      case mime_type when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg'
        when 'audio/mp4' then 'm4a' when 'audio/x-m4a' then 'm4a' when 'audio/wav' then 'wav'
        when 'audio/x-wav' then 'wav' when 'audio/mpeg' then 'mp3' when 'audio/aac' then 'aac'
      end
  ),
  ready_at timestamptz,
  unique (submission_id, question_id)
);
create index tcl_r24_sync_v1_submission_audio_assignment
  on public.tcl_r24_sync_v1_submission_audio (assignment_id, team_id, id);
create index tcl_r24_sync_v1_submission_audio_anchor
  on public.tcl_r24_sync_v1_submission_audio (assignment_id, team_id, anchor_id, id);

alter table public.tcl_r24_sync_v1_claims enable row level security;
alter table public.tcl_r24_sync_v1_submission_audio enable row level security;
revoke all on public.tcl_r24_sync_v1_claims, public.tcl_r24_sync_v1_submission_audio
  from public, anon, authenticated, service_role;
grant select, insert on public.tcl_r24_sync_v1_claims, public.tcl_r24_sync_v1_submission_audio to service_role;
grant update (ready_at) on public.tcl_r24_sync_v1_submission_audio to service_role;

-- Storage API physical upload is done by the server. Use the dedicated
-- private bucket; a signed-in buyer cannot get a public or signed URL here.
-- Refuse creation unless Storage already enforces row policies.
do $$
begin
  if (select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname in ('buckets', 'objects')
      and c.relrowsecurity) <> 2 then
    raise exception 'Private bucket requires existing storage row-level security';
  end if;
end;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tcl-r24-sync-v2-audio', 'tcl-r24-sync-v2-audio', false, 524288,
  array['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/x-wav','audio/mpeg','audio/aac','audio/x-m4a']);

-- Restrictive policies fail closed for the pilot bucket even if other
-- permissive policies exist. These predicates are true for every other bucket.
create policy tcl_r24_sync_v2_private_bucket on storage.buckets as restrictive
  for all to anon, authenticated
  using (id is distinct from 'tcl-r24-sync-v2-audio')
  with check (id is distinct from 'tcl-r24-sync-v2-audio');
create policy tcl_r24_sync_v2_private_audio on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id is distinct from 'tcl-r24-sync-v2-audio')
  with check (bucket_id is distinct from 'tcl-r24-sync-v2-audio');

commit;
