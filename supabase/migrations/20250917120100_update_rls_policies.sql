drop policy if exists "station_passages_select_station" on station_passages;
create policy "station_passages_select_station" on station_passages
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "station_passages_write_station" on station_passages;
create policy "station_passages_write_station" on station_passages
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "station_passages_update_station" on station_passages;
create policy "station_passages_update_station" on station_passages
  for update using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );