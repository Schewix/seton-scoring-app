-- Fix station assignment checks under authenticated role.
-- The policy helper must read judge_assignments regardless of caller table grants.
create or replace function public.is_station_account_assigned(
  p_event_id uuid,
  p_station_id uuid,
  p_account_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.judge_assignments ja
    where ja.event_id = p_event_id
      and ja.station_id = p_station_id
      and ja.judge_id = coalesce(p_account_id, public.current_station_account_id())
  );
$$;
revoke all on function public.is_station_account_assigned(uuid, uuid, uuid) from public;
grant execute on function public.is_station_account_assigned(uuid, uuid, uuid) to authenticated, service_role;
