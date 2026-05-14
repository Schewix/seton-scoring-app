create table if not exists public.event_maps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.station_map_positions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  x_percent numeric not null,
  y_percent numeric not null,
  created_at timestamptz not null default now(),
  unique (event_id, station_id)
);

create index if not exists station_map_positions_event_idx
  on public.station_map_positions(event_id);

create index if not exists station_map_positions_station_idx
  on public.station_map_positions(station_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'event_maps'
    ) then
      execute 'alter publication supabase_realtime add table public.event_maps';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'station_map_positions'
    ) then
      execute 'alter publication supabase_realtime add table public.station_map_positions';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'station_passages'
    ) then
      execute 'alter publication supabase_realtime add table public.station_passages';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'timings'
    ) then
      execute 'alter publication supabase_realtime add table public.timings';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'patrols'
    ) then
      execute 'alter publication supabase_realtime add table public.patrols';
    end if;
  end if;
end
$$;

alter table public.event_maps enable row level security;
alter table public.station_map_positions enable row level security;

grant select, insert, update, delete on public.event_maps to authenticated, service_role;
grant select, insert, update, delete on public.station_map_positions to authenticated, service_role;

drop policy if exists "event_maps_select_calc" on public.event_maps;
create policy "event_maps_select_calc" on public.event_maps
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "event_maps_write_calc" on public.event_maps;
create policy "event_maps_write_calc" on public.event_maps
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "event_maps_update_calc" on public.event_maps;
create policy "event_maps_update_calc" on public.event_maps
  for update using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "event_maps_delete_calc" on public.event_maps;
create policy "event_maps_delete_calc" on public.event_maps
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "station_map_positions_select_calc" on public.station_map_positions;
create policy "station_map_positions_select_calc" on public.station_map_positions
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "station_map_positions_write_calc" on public.station_map_positions;
create policy "station_map_positions_write_calc" on public.station_map_positions
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "station_map_positions_update_calc" on public.station_map_positions;
create policy "station_map_positions_update_calc" on public.station_map_positions
  for update using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

drop policy if exists "station_map_positions_delete_calc" on public.station_map_positions;
create policy "station_map_positions_delete_calc" on public.station_map_positions
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and exists (
        select 1
        from public.stations s
        where s.id = public.current_station_id()
          and s.event_id = event_id
          and s.code = 'T'
          and public.is_station_account_assigned(
            event_id,
            s.id,
            public.current_station_account_id()
          )
      )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-maps',
  'event-maps',
  true,
  15728640,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event_maps_storage_read" on storage.objects;
create policy "event_maps_storage_read" on storage.objects
  for select using (
    bucket_id = 'event-maps'
    and auth.role() in ('authenticated', 'service_role')
  );

drop policy if exists "event_maps_storage_insert" on storage.objects;
create policy "event_maps_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'event-maps'
    and auth.role() in ('authenticated', 'service_role')
  );

drop policy if exists "event_maps_storage_update" on storage.objects;
create policy "event_maps_storage_update" on storage.objects
  for update using (
    bucket_id = 'event-maps'
    and auth.role() in ('authenticated', 'service_role')
  ) with check (
    bucket_id = 'event-maps'
    and auth.role() in ('authenticated', 'service_role')
  );

drop policy if exists "event_maps_storage_delete" on storage.objects;
create policy "event_maps_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'event-maps'
    and auth.role() in ('authenticated', 'service_role')
  );
