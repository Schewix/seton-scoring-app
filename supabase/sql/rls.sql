-- Example RLS (adjust to your auth model). Enable RLS then define policies.
alter table patrols enable row level security;
alter table stations enable row level security;
alter table station_passages enable row level security;
alter table station_scores enable row level security;
alter table timings enable row level security;
alter table station_category_answers enable row level security;
alter table station_quiz_responses enable row level security;

-- Helper predicates (expects JWT to carry event_id/station_id claims for judges)
drop policy if exists "read_all_patrols" on patrols;
create policy "patrols_select_event" on patrols
  for select using (
    auth.role() = 'service_role' or auth.jwt()->>'event_id' = event_id::text
  );

drop policy if exists "read_all_stations" on stations;
create policy "stations_select_event" on stations
  for select using (
    auth.role() = 'service_role' or auth.jwt()->>'event_id' = event_id::text
  );

drop policy if exists "read_all_passages" on station_passages;
create policy "station_passages_select_station" on station_passages
  for select using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_passages_write_station" on station_passages
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_passages_update_station" on station_passages
  for update using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_passages_delete_station" on station_passages
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "read_all_scores" on station_scores;
create policy "station_scores_select_station" on station_scores
  for select using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_scores_write_station" on station_scores
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_scores_update_station" on station_scores
  for update using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "station_scores_delete_station" on station_scores
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "read_all_category_answers" on station_category_answers;
create policy "category_answers_select_station" on station_category_answers
  for select using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "category_answers_write_station" on station_category_answers
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "category_answers_update_station" on station_category_answers
  for update using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "category_answers_delete_station" on station_category_answers
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "read_all_quiz_responses" on station_quiz_responses;
create policy "quiz_responses_select_station" on station_quiz_responses
  for select using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "quiz_responses_write_station" on station_quiz_responses
  for insert with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "quiz_responses_update_station" on station_quiz_responses
  for update using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  ) with check (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

create policy "quiz_responses_delete_station" on station_quiz_responses
  for delete using (
    auth.role() = 'service_role'
    or (
      auth.jwt()->>'event_id' = event_id::text
      and auth.jwt()->>'station_id' = station_id::text
    )
  );

drop policy if exists "read_all_timings" on timings;
create policy "timings_select_event" on timings
  for select using (
    auth.role() = 'service_role'
    or auth.jwt()->>'event_id' = event_id::text
  );

create policy "timings_write_event" on timings
  for insert with check (
    auth.role() = 'service_role'
    or auth.jwt()->>'event_id' = event_id::text
  );

create policy "timings_update_event" on timings
  for update using (
    auth.role() = 'service_role'
    or auth.jwt()->>'event_id' = event_id::text
  ) with check (
    auth.role() = 'service_role'
    or auth.jwt()->>'event_id' = event_id::text
  );

create policy "timings_delete_event" on timings
  for delete using (
    auth.role() = 'service_role'
    or auth.jwt()->>'event_id' = event_id::text
  );
