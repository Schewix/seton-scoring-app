-- Prepare station/account mapping for multi-account station access.
-- Keep judge_assignments as canonical storage and expose station_judges view
-- for forward-compatible account-based authorization.

alter table public.judge_assignments
  add column if not exists role text not null default 'judge';
alter table public.judge_assignments
  add column if not exists judge_display_name text;
alter table public.judge_assignments
  add column if not exists updated_at timestamptz not null default now();
create index if not exists judge_assignments_event_station_idx
  on public.judge_assignments(event_id, station_id);
create or replace function public.current_station_account_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_sub text;
begin
  raw_sub := nullif(auth.jwt()->>'sub', '');
  if raw_sub is null then
    return null;
  end if;

  begin
    return raw_sub::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;
create or replace function public.current_station_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_station text;
begin
  raw_station := nullif(auth.jwt()->>'station_id', '');
  if raw_station is null then
    return null;
  end if;

  begin
    return raw_station::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;
create or replace function public.is_station_account_assigned(
  p_event_id uuid,
  p_station_id uuid,
  p_account_id uuid default null
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.judge_assignments ja
    where ja.event_id = p_event_id
      and ja.station_id = p_station_id
      and ja.judge_id = coalesce(p_account_id, public.current_station_account_id())
  );
$$;
drop view if exists public.station_judges;
create view public.station_judges as
select
  ja.id,
  ja.event_id,
  ja.station_id,
  ja.judge_id as account_id,
  ja.role,
  ja.allowed_categories,
  ja.allowed_tasks,
  ja.judge_display_name,
  ja.created_at,
  ja.updated_at
from public.judge_assignments ja;
comment on view public.station_judges is
  'Station/account assignment mapping used for station authorization. Backed by judge_assignments.';
grant select on public.station_judges to authenticated, service_role;
-- station_passages
drop policy if exists "station_passages_select_station" on public.station_passages;
create policy "station_passages_select_station" on public.station_passages
  for select using (
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and auth.jwt()->>'event_id' = event_id::text
      and (
        (
          auth.jwt()->>'station_id' = station_id::text
          and public.is_station_account_assigned(
            event_id,
            station_id,
            public.current_station_account_id()
          )
        )
        or exists (
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
    )
  );
drop policy if exists "station_passages_write_station" on public.station_passages;
create policy "station_passages_write_station" on public.station_passages
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
drop policy if exists "station_passages_update_station" on public.station_passages;
create policy "station_passages_update_station" on public.station_passages
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
drop policy if exists "station_passages_delete_station" on public.station_passages;
create policy "station_passages_delete_station" on public.station_passages
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
-- station_scores
drop policy if exists "station_scores_select_station" on public.station_scores;
create policy "station_scores_select_station" on public.station_scores
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
drop policy if exists "station_scores_write_station" on public.station_scores;
create policy "station_scores_write_station" on public.station_scores
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
drop policy if exists "station_scores_update_station" on public.station_scores;
create policy "station_scores_update_station" on public.station_scores
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
drop policy if exists "station_scores_delete_station" on public.station_scores;
create policy "station_scores_delete_station" on public.station_scores
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
-- station_category_answers
drop policy if exists "category_answers_select_station" on public.station_category_answers;
create policy "category_answers_select_station" on public.station_category_answers
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
drop policy if exists "category_answers_write_station" on public.station_category_answers;
create policy "category_answers_write_station" on public.station_category_answers
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
drop policy if exists "category_answers_update_station" on public.station_category_answers;
create policy "category_answers_update_station" on public.station_category_answers
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
drop policy if exists "category_answers_delete_station" on public.station_category_answers;
create policy "category_answers_delete_station" on public.station_category_answers
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
-- station_quiz_responses
drop policy if exists "quiz_responses_select_station" on public.station_quiz_responses;
create policy "quiz_responses_select_station" on public.station_quiz_responses
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
drop policy if exists "quiz_responses_write_station" on public.station_quiz_responses;
create policy "quiz_responses_write_station" on public.station_quiz_responses
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
drop policy if exists "quiz_responses_update_station" on public.station_quiz_responses;
create policy "quiz_responses_update_station" on public.station_quiz_responses
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
drop policy if exists "quiz_responses_delete_station" on public.station_quiz_responses;
create policy "quiz_responses_delete_station" on public.station_quiz_responses
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
