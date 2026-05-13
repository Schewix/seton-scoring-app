create table if not exists public.event_station_orders (
  event_id uuid primary key references public.events(id) on delete cascade,
  category_orders jsonb not null default '{}'::jsonb,
  separator_before_by_category jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists event_station_orders_updated_at_idx
  on public.event_station_orders(updated_at desc);
