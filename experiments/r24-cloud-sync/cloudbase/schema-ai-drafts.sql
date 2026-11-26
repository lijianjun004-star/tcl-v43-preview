begin;

create table if not exists public.tcl_r24_sync_v1_ai_draft_quota (
  usage_day date primary key,
  reserved_calls integer not null check (reserved_calls between 1 and 20)
);

alter table public.tcl_r24_sync_v1_ai_draft_quota enable row level security;
revoke all on table public.tcl_r24_sync_v1_ai_draft_quota
  from public, anon, authenticated, service_role;

create or replace function public.tcl_r24_sync_v1_reserve_ai_draft(p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_daily_limit is null or p_daily_limit not between 1 and 20 then
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
