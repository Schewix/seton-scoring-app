-- Enums
do $$ begin
  create type category as enum ('N','M','S','R');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sex as enum ('H','D');
exception when duplicate_object then null; end $$;

-- Core tables
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz
);

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'events' and column_name = 'scoring_locked'
  ) then
    alter table events add column scoring_locked boolean not null default false;
  end if;
exception when duplicate_column then null; end $$;

create table if not exists patrols (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_name text not null,
  category category not null,
  sex sex not null,
  patrol_code text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, patrol_code)
);

create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  code text not null,  -- e.g., 'A'..'T'
  name text not null
);

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stations_event_code_key'
  ) then
    alter table stations add constraint stations_event_code_key unique (event_id, code);
  end if;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stations_id_event_key'
  ) then
    alter table stations add constraint stations_id_event_key unique (id, event_id);
  end if;
exception when duplicate_object then null; end $$;

create table if not exists station_passages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  patrol_id uuid not null references patrols(id) on delete cascade,
  station_id uuid not null references stations(id) on delete restrict,
  arrived_at timestamptz,
  left_at timestamptz,
  wait_minutes int not null default 0,
  unique (event_id, patrol_id, station_id)
);

create table if not exists station_scores (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  patrol_id uuid not null references patrols(id) on delete cascade,
  station_id uuid not null references stations(id) on delete restrict,
  points int not null,
  judge text,
  note text,
  created_at timestamptz not null default now(),
  unique (event_id, patrol_id, station_id)
);

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_scores' and column_name = 'client_event_id'
  ) then
    alter table station_scores add column client_event_id uuid;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_scores' and column_name = 'client_created_at'
  ) then
    alter table station_scores add column client_created_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_scores' and column_name = 'submitted_by'
  ) then
    alter table station_scores add column submitted_by uuid;
  end if;
exception when duplicate_column then null; end $$;

create table if not exists station_category_answers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  category category not null,
  correct_answers text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, station_id, category)
);

create table if not exists station_quiz_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  patrol_id uuid not null references patrols(id) on delete cascade,
  category category not null,
  answers text not null,
  correct_count int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, station_id, patrol_id)
);

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_passages' and column_name = 'client_event_id'
  ) then
    alter table station_passages add column client_event_id uuid;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_passages' and column_name = 'client_created_at'
  ) then
    alter table station_passages add column client_created_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_passages' and column_name = 'submitted_by'
  ) then
    alter table station_passages add column submitted_by uuid;
  end if;
exception when duplicate_column then null; end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_quiz_responses' and column_name = 'client_event_id'
  ) then
    alter table station_quiz_responses add column client_event_id uuid;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_quiz_responses' and column_name = 'client_created_at'
  ) then
    alter table station_quiz_responses add column client_created_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'station_quiz_responses' and column_name = 'submitted_by'
  ) then
    alter table station_quiz_responses add column submitted_by uuid;
  end if;
exception when duplicate_column then null; end $$;

create table if not exists timings (
  event_id uuid references events(id) on delete cascade,
  patrol_id uuid references patrols(id) on delete cascade,
  start_time timestamptz,
  finish_time timestamptz,
  primary key (event_id, patrol_id)
);

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'timings' and column_name = 'client_event_id'
  ) then
    alter table timings add column client_event_id uuid;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'timings' and column_name = 'client_created_at'
  ) then
    alter table timings add column client_created_at timestamptz;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'timings' and column_name = 'submitted_by'
  ) then
    alter table timings add column submitted_by uuid;
  end if;
exception when duplicate_column then null; end $$;

create index if not exists patrols_event_idx on patrols(event_id);
create index if not exists station_scores_event_station_idx on station_scores(event_id, station_id);
create index if not exists passages_event_station_idx on station_passages(event_id, station_id);
create index if not exists category_answers_event_station_idx on station_category_answers(event_id, station_id);
create index if not exists quiz_responses_event_station_idx on station_quiz_responses(event_id, station_id);
create unique index if not exists station_scores_client_event_id_idx on station_scores(client_event_id);
create unique index if not exists station_passages_client_event_id_idx on station_passages(client_event_id);
create unique index if not exists station_quiz_responses_client_event_id_idx on station_quiz_responses(client_event_id);
create unique index if not exists timings_client_event_id_idx on timings(client_event_id);

create table if not exists judges (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'judges' and column_name = 'password_rotated_at'
  ) then
    alter table judges add column password_rotated_at timestamptz;
  end if;
exception when duplicate_column then null; end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'judges' and column_name = 'onboarding_sent_at'
  ) then
    alter table judges add column onboarding_sent_at timestamptz;
  end if;
exception when duplicate_column then null; end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'judges' and column_name = 'must_change_password'
  ) then
    alter table judges add column must_change_password boolean not null default true;
  end if;
exception when duplicate_column then null; end $$;

create table if not exists judge_assignments (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  allowed_categories category[] not null default array[]::category[],
  allowed_tasks text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  unique (judge_id, station_id, event_id)
);

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'judge_assignments_station_event_fkey'
  ) then
    alter table judge_assignments
      add constraint judge_assignments_station_event_fkey
      foreign key (station_id, event_id)
      references stations(id, event_id)
      on delete cascade;
  end if;
exception when duplicate_object then null; end $$;

create table if not exists judge_sessions (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  device_salt text not null,
  public_key text,
  manifest_version int not null default 1,
  refresh_token_hash text not null,
  refresh_token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (judge_id, station_id, device_salt)
);

create index if not exists judge_assignments_station_idx on judge_assignments(station_id);
create index if not exists judge_sessions_judge_idx on judge_sessions(judge_id);

create table if not exists judge_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  station_id uuid references stations(id) on delete cascade,
  token_hash text,
  expires_at timestamptz,
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivery_channel text not null default 'email',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists judge_onboarding_events_judge_idx on judge_onboarding_events(judge_id);
create index if not exists judge_onboarding_events_token_hash_idx on judge_onboarding_events(token_hash);

create or replace function public.submit_station_record(
  p_event_id uuid,
  p_station_id uuid,
  p_patrol_id uuid,
  p_category category,
  p_arrived_at timestamptz,
  p_wait_minutes int,
  p_points int,
  p_note text,
  p_use_target_scoring boolean,
  p_normalized_answers text,
  p_finish_time timestamptz,
  p_client_event_id uuid,
  p_client_created_at timestamptz,
  p_submitted_by uuid
)
returns station_scores
language plpgsql
security definer
set search_path = public
as $$
declare
  result station_scores;
begin
  insert into station_passages (
    event_id,
    station_id,
    patrol_id,
    arrived_at,
    wait_minutes,
    client_event_id,
    client_created_at,
    submitted_by
  ) values (
    p_event_id,
    p_station_id,
    p_patrol_id,
    p_arrived_at,
    p_wait_minutes,
    p_client_event_id,
    p_client_created_at,
    p_submitted_by
  )
  on conflict (event_id, patrol_id, station_id)
  do update set
    arrived_at = excluded.arrived_at,
    wait_minutes = excluded.wait_minutes,
    client_event_id = excluded.client_event_id,
    client_created_at = excluded.client_created_at,
    submitted_by = excluded.submitted_by
  where station_passages.client_created_at is null
     or station_passages.client_created_at <= excluded.client_created_at;

  insert into station_scores (
    event_id,
    station_id,
    patrol_id,
    points,
    note,
    client_event_id,
    client_created_at,
    submitted_by
  ) values (
    p_event_id,
    p_station_id,
    p_patrol_id,
    p_points,
    nullif(p_note, ''),
    p_client_event_id,
    p_client_created_at,
    p_submitted_by
  )
  on conflict (event_id, patrol_id, station_id)
  do update set
    points = excluded.points,
    note = excluded.note,
    client_event_id = excluded.client_event_id,
    client_created_at = excluded.client_created_at,
    submitted_by = excluded.submitted_by
  where station_scores.client_created_at is null
     or station_scores.client_created_at <= excluded.client_created_at;

  if p_finish_time is not null then
    insert into timings (
      event_id,
      patrol_id,
      finish_time,
      client_event_id,
      client_created_at,
      submitted_by
    ) values (
      p_event_id,
      p_patrol_id,
      p_finish_time,
      p_client_event_id,
      p_client_created_at,
      p_submitted_by
    )
    on conflict (event_id, patrol_id)
    do update set
      finish_time = excluded.finish_time,
      client_event_id = excluded.client_event_id,
      client_created_at = excluded.client_created_at,
      submitted_by = excluded.submitted_by
    where timings.client_created_at is null
       or timings.client_created_at <= excluded.client_created_at;
  end if;

  if p_use_target_scoring and p_normalized_answers is not null then
    insert into station_quiz_responses (
      event_id,
      station_id,
      patrol_id,
      category,
      answers,
      correct_count,
      client_event_id,
      client_created_at,
      submitted_by
    ) values (
      p_event_id,
      p_station_id,
      p_patrol_id,
      p_category,
      p_normalized_answers,
      p_points,
      p_client_event_id,
      p_client_created_at,
      p_submitted_by
    )
    on conflict (event_id, station_id, patrol_id)
    do update set
      category = excluded.category,
      answers = excluded.answers,
      correct_count = excluded.correct_count,
      client_event_id = excluded.client_event_id,
      client_created_at = excluded.client_created_at,
      submitted_by = excluded.submitted_by
    where station_quiz_responses.client_created_at is null
       or station_quiz_responses.client_created_at <= excluded.client_created_at;
  else
    delete from station_quiz_responses
      where event_id = p_event_id
        and station_id = p_station_id
        and patrol_id = p_patrol_id
        and (client_created_at is null or client_created_at <= p_client_created_at);
  end if;

  select * into result
    from station_scores
    where event_id = p_event_id
      and station_id = p_station_id
      and patrol_id = p_patrol_id;

  return result;
end;
$$;
