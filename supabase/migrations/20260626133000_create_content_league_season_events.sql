create table if not exists public.content_league_season_events (
  season_id text not null references public.content_league_seasons (id) on delete cascade,
  event_key text not null,
  event_label text not null,
  event_name text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, event_key)
);

insert into public.content_league_season_events (season_id, event_key, event_label, event_name, order_index)
values
  ('2025-2026', 'pto-ob', 'PTOB', 'Orientační běh', 0),
  ('2025-2026', 'ds', 'DS', 'Dračí smyčka', 1),
  ('2025-2026', 'kp', 'KP', 'Kosmův prostor', 2),
  ('2025-2026', 'zls', 'Seton', 'Setonův závod', 3)
on conflict (season_id, event_key) do update
set event_label = excluded.event_label,
    event_name = excluded.event_name,
    order_index = excluded.order_index;

create index if not exists content_league_season_events_season_idx
  on public.content_league_season_events (season_id, order_index);

create or replace function public.set_content_league_season_events_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_league_season_events_updated_at on public.content_league_season_events;
create trigger set_content_league_season_events_updated_at
  before update on public.content_league_season_events
  for each row execute function public.set_content_league_season_events_updated_at();

alter table public.content_league_season_events enable row level security;
