-- Optional: allow TCL_R24_SYNC_AI_DAILY_LIMIT values above 20 (up to 10000).
-- Needed only when the pilot sets a numeric cap above 20. An unset or empty
-- limit does not reserve quota at all, so it needs no database change.
-- Run after schema-ai-drafts.sql as the owner of the pilot tables; it is safe to re-run.
begin;

alter table public.tcl_r24_sync_v1_ai_draft_quota
  drop constraint if exists tcl_r24_sync_v1_ai_draft_quota_reserved_calls_check;
alter table public.tcl_r24_sync_v1_ai_draft_quota
  add constraint tcl_r24_sync_v1_ai_draft_quota_reserved_calls_check check (reserved_calls between 1 and 10000);

create or replace function public.tcl_r24_sync_v1_reserve_ai_draft(p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_daily_limit is null or p_daily_limit not between 1 and 10000 then
    raise exception 'invalid AI draft daily limit' using errcode = '22023';
  end if;

  -- The conditional upsert reserves one attempt without a separate quota read.
  insert into public.tcl_r24_sync_v1_ai_draft_quota as quota (usage_day, reserved_calls)
  values ((pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date, 1)
  on conflict (usage_day) do update set reserved_calls = quota.reserved_calls + 1
  where quota.reserved_calls < p_daily_limit;

  return found;
end;
$$;

revoke all on function public.tcl_r24_sync_v1_reserve_ai_draft(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.tcl_r24_sync_v1_reserve_ai_draft(integer) to service_role;

commit;
