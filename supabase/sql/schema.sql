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
