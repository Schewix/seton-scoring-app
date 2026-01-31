create table if not exists public.content_league_scores (
  id uuid primary key default gen_random_uuid(),
  troop_id text not null,
  event_key text not null,
  points double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_league_scores_unique_idx
  on public.content_league_scores (troop_id, event_key);

create index if not exists content_league_scores_troop_idx
  on public.content_league_scores (troop_id);

create index if not exists content_league_scores_event_idx
  on public.content_league_scores (event_key);

create or replace function public.set_content_league_scores_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_league_scores_updated_at on public.content_league_scores;
create trigger set_content_league_scores_updated_at
  before update on public.content_league_scores
  for each row execute function public.set_content_league_scores_updated_at();

alter table public.content_league_scores enable row level security;
