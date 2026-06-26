create table if not exists public.content_league_seasons (
  id text primary key,
  name text not null,
  is_active boolean not null default false,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_league_season_troops (
  season_id text not null references public.content_league_seasons (id) on delete cascade,
  troop_id text not null,
  troop_name text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, troop_id)
);

alter table public.content_league_scores
  add column if not exists season_id text;

insert into public.content_league_seasons (id, name, is_active, starts_on, ends_on)
values ('2025-2026', 'Ročník 2025/2026', true, '2025-09-01', '2026-06-30')
on conflict (id) do update
set name = excluded.name,
    is_active = true,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on;

update public.content_league_scores
set season_id = '2025-2026'
where season_id is null;

alter table public.content_league_scores
  alter column season_id set default '2025-2026';

insert into public.content_league_season_troops (season_id, troop_id, troop_name, order_index)
values
  ('2025-2026', '63-phoenix', '63. PTO Phoenix', 0),
  ('2025-2026', '6-nibowaka', '6. PTO Nibowaka', 1),
  ('2025-2026', '66-brabrouci', '66. PTO Brabrouci', 2),
  ('2025-2026', 'zs-pcv', 'ZS PCV', 3),
  ('2025-2026', '10-severka', '10. PTO Severka', 4),
  ('2025-2026', '176-vlcata', '176. PTO Vlčata', 5),
  ('2025-2026', '34-tulak', '34. PTO Tulák', 6),
  ('2025-2026', '21-hady', '21. PTO Hády', 7),
  ('2025-2026', '32-severka', '32. PTO Severka', 8),
  ('2025-2026', '64-lorien', '64. PTO Lorien', 9),
  ('2025-2026', '48-stezka', '48. PTO Stezka', 10),
  ('2025-2026', '2-poutnici', '2. PTO Poutníci', 11),
  ('2025-2026', '111-vinohrady', '111. PTO Vinohrady', 12),
  ('2025-2026', '8-mustangove', '8. PTO Mustangové', 13),
  ('2025-2026', '11-iktomi', '11. PTO Iktomi', 14),
  ('2025-2026', '15-vatra', '15. PTO Vatra', 15),
  ('2025-2026', '41-dracata', '41. PTO Dráčata', 16),
  ('2025-2026', '61-tuhas', '61. PTO Tuhas', 17),
  ('2025-2026', '99-kamzici', '99. PTO Kamzíci', 18),
  ('2025-2026', '172-pegas', '172. PTO Pegas', 19),
  ('2025-2026', 'zabky-jedovnice', 'PTO Žabky Jedovnice', 20)
on conflict (season_id, troop_id) do update
set troop_name = excluded.troop_name,
    order_index = excluded.order_index;

drop index if exists public.content_league_scores_unique_idx;

create unique index if not exists content_league_scores_unique_idx
  on public.content_league_scores (season_id, troop_id, event_key);

create index if not exists content_league_scores_season_idx
  on public.content_league_scores (season_id);

create index if not exists content_league_seasons_active_idx
  on public.content_league_seasons (is_active);

create index if not exists content_league_season_troops_season_idx
  on public.content_league_season_troops (season_id, order_index);

create or replace function public.set_content_league_seasons_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_league_seasons_updated_at on public.content_league_seasons;
create trigger set_content_league_seasons_updated_at
  before update on public.content_league_seasons
  for each row execute function public.set_content_league_seasons_updated_at();

create or replace function public.set_content_league_season_troops_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_league_season_troops_updated_at on public.content_league_season_troops;
create trigger set_content_league_season_troops_updated_at
  before update on public.content_league_season_troops
  for each row execute function public.set_content_league_season_troops_updated_at();

alter table public.content_league_seasons enable row level security;
alter table public.content_league_season_troops enable row level security;
