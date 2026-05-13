alter table public.events
  add column if not exists announced_places_n integer not null default 5,
  add column if not exists announced_places_m integer not null default 6,
  add column if not exists announced_places_s integer not null default 6,
  add column if not exists announced_places_r integer not null default 3,
  add column if not exists time_limit_n_minutes integer not null default 110,
  add column if not exists time_limit_m_minutes integer not null default 140,
  add column if not exists time_limit_s_minutes integer not null default 140,
  add column if not exists time_limit_r_minutes integer not null default 140,
  add column if not exists time_penalty_step_minutes integer not null default 20,
  add column if not exists participating_troops text[] not null default '{}';

update public.events
set
  announced_places_n = greatest(1, coalesce(announced_places_n, 5)),
  announced_places_m = greatest(1, coalesce(announced_places_m, 6)),
  announced_places_s = greatest(1, coalesce(announced_places_s, 6)),
  announced_places_r = greatest(1, coalesce(announced_places_r, 3)),
  time_limit_n_minutes = greatest(1, coalesce(time_limit_n_minutes, 110)),
  time_limit_m_minutes = greatest(1, coalesce(time_limit_m_minutes, 140)),
  time_limit_s_minutes = greatest(1, coalesce(time_limit_s_minutes, 140)),
  time_limit_r_minutes = greatest(1, coalesce(time_limit_r_minutes, 140)),
  time_penalty_step_minutes = greatest(1, coalesce(time_penalty_step_minutes, 20)),
  participating_troops = coalesce(participating_troops, '{}');

create or replace view public.events_public as
select
  e.id,
  e.name,
  e.starts_at,
  e.ends_at,
  e.announced_places_n,
  e.announced_places_m,
  e.announced_places_s,
  e.announced_places_r,
  e.time_limit_n_minutes,
  e.time_limit_m_minutes,
  e.time_limit_s_minutes,
  e.time_limit_r_minutes,
  e.time_penalty_step_minutes,
  e.participating_troops
from public.events e;

grant select on public.events_public to anon, authenticated;
