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

create table if not exists timings (
  event_id uuid references events(id) on delete cascade,
  patrol_id uuid references patrols(id) on delete cascade,
  start_time timestamptz,
  finish_time timestamptz,
  primary key (event_id, patrol_id)
);

create index if not exists patrols_event_idx on patrols(event_id);
create index if not exists station_scores_event_station_idx on station_scores(event_id, station_id);
create index if not exists passages_event_station_idx on station_passages(event_id, station_id);
create index if not exists category_answers_event_station_idx on station_category_answers(event_id, station_id);
create index if not exists quiz_responses_event_station_idx on station_quiz_responses(event_id, station_id);

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
