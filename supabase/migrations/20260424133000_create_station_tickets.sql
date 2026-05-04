create table if not exists public.station_tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  patrol_id uuid not null references public.patrols(id) on delete cascade,
  state text not null check (state in ('waiting', 'serving', 'done')),
  patrol_code text not null default '',
  team_name text not null default '',
  category category,
  sex sex,
  arrived_at timestamptz,
  served_at timestamptz,
  wait_started_at timestamptz,
  wait_accum_ms bigint not null default 0,
  serve_accum_ms bigint not null default 0,
  points int,
  updated_by uuid references public.judges(id) on delete set null,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, station_id, patrol_id)
);
create index if not exists station_tickets_event_station_state_idx
  on public.station_tickets(event_id, station_id, state);
create index if not exists station_tickets_event_station_updated_idx
  on public.station_tickets(event_id, station_id, updated_at desc);
alter table public.station_tickets enable row level security;
drop policy if exists "station_tickets_select_station" on public.station_tickets;
create policy "station_tickets_select_station" on public.station_tickets
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
      and public.is_station_account_assigned(
        event_id,
        station_id,
        public.current_station_account_id()
      )
    )
  );
drop policy if exists "station_tickets_write_station" on public.station_tickets;
create policy "station_tickets_write_station" on public.station_tickets
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
      and public.is_station_account_assigned(
        event_id,
        station_id,
        public.current_station_account_id()
      )
    )
  );
drop policy if exists "station_tickets_update_station" on public.station_tickets;
create policy "station_tickets_update_station" on public.station_tickets
  for update using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
      and public.is_station_account_assigned(
        event_id,
        station_id,
        public.current_station_account_id()
      )
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
      and public.is_station_account_assigned(
        event_id,
        station_id,
        public.current_station_account_id()
      )
    )
  );
drop policy if exists "station_tickets_delete_station" on public.station_tickets;
create policy "station_tickets_delete_station" on public.station_tickets
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
      and public.is_station_account_assigned(
        event_id,
        station_id,
        public.current_station_account_id()
      )
    )
  );
create or replace function public.list_station_tickets(
  p_event_id uuid,
  p_station_id uuid
)
returns setof public.station_tickets
language sql
stable
as $$
  select st.*
  from public.station_tickets st
  where st.event_id = p_event_id
    and st.station_id = p_station_id
  order by st.updated_at asc, st.created_at asc;
$$;
create or replace function public.upsert_station_ticket(
  p_event_id uuid,
  p_station_id uuid,
  p_patrol_id uuid,
  p_state text,
  p_patrol_code text,
  p_team_name text,
  p_category category,
  p_sex sex,
  p_arrived_at timestamptz,
  p_served_at timestamptz,
  p_wait_started_at timestamptz,
  p_wait_accum_ms bigint,
  p_serve_accum_ms bigint,
  p_points int,
  p_client_updated_at timestamptz,
  p_updated_by uuid default null
)
returns public.station_tickets
language plpgsql
as $$
declare
  result public.station_tickets;
begin
  if p_state not in ('waiting', 'serving', 'done') then
    raise exception 'invalid station_tickets state: %', p_state;
  end if;

  insert into public.station_tickets (
    event_id,
    station_id,
    patrol_id,
    state,
    patrol_code,
    team_name,
    category,
    sex,
    arrived_at,
    served_at,
    wait_started_at,
    wait_accum_ms,
    serve_accum_ms,
    points,
    updated_by,
    client_updated_at,
    updated_at
  ) values (
    p_event_id,
    p_station_id,
    p_patrol_id,
    p_state,
    coalesce(p_patrol_code, ''),
    coalesce(p_team_name, ''),
    p_category,
    p_sex,
    p_arrived_at,
    p_served_at,
    p_wait_started_at,
    coalesce(p_wait_accum_ms, 0),
    coalesce(p_serve_accum_ms, 0),
    p_points,
    p_updated_by,
    coalesce(p_client_updated_at, now()),
    now()
  )
  on conflict (event_id, station_id, patrol_id)
  do update set
    state = excluded.state,
    patrol_code = excluded.patrol_code,
    team_name = excluded.team_name,
    category = excluded.category,
    sex = excluded.sex,
    arrived_at = excluded.arrived_at,
    served_at = excluded.served_at,
    wait_started_at = excluded.wait_started_at,
    wait_accum_ms = excluded.wait_accum_ms,
    serve_accum_ms = excluded.serve_accum_ms,
    points = excluded.points,
    updated_by = excluded.updated_by,
    client_updated_at = excluded.client_updated_at,
    updated_at = now()
  where public.station_tickets.client_updated_at is null
     or public.station_tickets.client_updated_at <= excluded.client_updated_at
  returning * into result;

  if result.id is null then
    select st.*
    into result
    from public.station_tickets st
    where st.event_id = p_event_id
      and st.station_id = p_station_id
      and st.patrol_id = p_patrol_id;
  end if;

  return result;
end;
$$;
grant select, insert, update, delete on public.station_tickets to authenticated, service_role;
grant execute on function public.list_station_tickets(uuid, uuid) to authenticated, service_role;
grant execute on function public.upsert_station_ticket(
  uuid, uuid, uuid, text, text, text, category, sex, timestamptz, timestamptz, timestamptz,
  bigint, bigint, int, timestamptz, uuid
) to authenticated, service_role;
