-- Example RLS (adjust to your auth model). Enable RLS then define policies.
alter table patrols enable row level security;
alter table stations enable row level security;
alter table station_passages enable row level security;
alter table station_scores enable row level security;
alter table timings enable row level security;
alter table station_category_answers enable row level security;
alter table station_quiz_responses enable row level security;

-- Admins (role 'service_role' or your JWT claim) can do anything. For brevity:
create policy "read_all_patrols" on patrols for select using (true);
create policy "read_all_stations" on stations for select using (true);
create policy "read_all_passages" on station_passages for select using (true);
create policy "read_all_scores" on station_scores for select using (true);
create policy "read_all_timings" on timings for select using (true);
create policy "read_all_category_answers" on station_category_answers for select using (true);
create policy "read_all_quiz_responses" on station_quiz_responses for select using (true);

-- TODO: Replace with tighter rules, e.g. allow insert/update on scores/passages
-- only for users assigned to the given event & station.
