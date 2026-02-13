-- Allow calc station (code T) to read all station passages within its event.

drop policy if exists "station_passages_select_station" on station_passages;
create policy "station_passages_select_station" on station_passages
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and (
        auth.jwt()->>'station_id' = station_id::text
        or exists (
          select 1
          from stations s
          where s.id = (auth.jwt()->>'station_id')::uuid
            and s.code = 'T'
            and s.event_id = event_id
        )
      )
    )
  );
