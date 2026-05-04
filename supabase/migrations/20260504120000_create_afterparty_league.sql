do $$ begin
  create type public.afterparty_order_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.afterparty_participants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  troop_name text not null check (length(trim(troop_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.afterparty_orders (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.afterparty_participants(id) on delete cascade,
  status public.afterparty_order_status not null default 'pending',
  receipt_path text not null,
  total_points int not null default 0 check (total_points >= 0),
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.judges(id) on delete set null
);

create table if not exists public.afterparty_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.afterparty_orders(id) on delete cascade,
  drink_key text not null,
  label text not null,
  category text not null,
  quantity int not null check (quantity >= 0),
  approved_quantity int not null check (approved_quantity >= 0),
  points_each int not null default 5 check (points_each >= 0),
  points_total int not null default 0 check (points_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists afterparty_participants_troop_idx on public.afterparty_participants(troop_name);
create index if not exists afterparty_orders_status_submitted_idx on public.afterparty_orders(status, submitted_at desc);
create index if not exists afterparty_orders_participant_idx on public.afterparty_orders(participant_id, submitted_at desc);
create index if not exists afterparty_order_items_order_idx on public.afterparty_order_items(order_id);

create or replace view public.afterparty_individual_leaderboard as
select
  p.id as participant_id,
  p.display_name,
  p.troop_name,
  coalesce(sum(o.total_points), 0)::int as total_points,
  count(o.id)::int as approved_orders
from public.afterparty_participants p
left join public.afterparty_orders o
  on o.participant_id = p.id
  and o.status = 'approved'
group by p.id, p.display_name, p.troop_name;

create or replace view public.afterparty_troop_leaderboard as
select
  p.troop_name,
  coalesce(sum(o.total_points), 0)::int as total_points,
  count(distinct p.id)::int as participants,
  count(o.id)::int as approved_orders
from public.afterparty_participants p
left join public.afterparty_orders o
  on o.participant_id = p.id
  and o.status = 'approved'
group by p.troop_name;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'afterparty-receipts',
  'afterparty-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.afterparty_participants enable row level security;
alter table public.afterparty_orders enable row level security;
alter table public.afterparty_order_items enable row level security;

drop policy if exists "afterparty_participants_read" on public.afterparty_participants;
create policy "afterparty_participants_read" on public.afterparty_participants
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_participants_insert" on public.afterparty_participants;
create policy "afterparty_participants_insert" on public.afterparty_participants
  for insert with check (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_participants_update" on public.afterparty_participants;
create policy "afterparty_participants_update" on public.afterparty_participants
  for update using (auth.role() in ('anon', 'authenticated', 'service_role'))
  with check (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_orders_read" on public.afterparty_orders;
create policy "afterparty_orders_read" on public.afterparty_orders
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_orders_insert" on public.afterparty_orders;
create policy "afterparty_orders_insert" on public.afterparty_orders
  for insert with check (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_orders_update_admin" on public.afterparty_orders;
create policy "afterparty_orders_update_admin" on public.afterparty_orders
  for update using (auth.role() = 'service_role' or public.board_is_admin_user())
  with check (auth.role() = 'service_role' or public.board_is_admin_user());

drop policy if exists "afterparty_order_items_read" on public.afterparty_order_items;
create policy "afterparty_order_items_read" on public.afterparty_order_items
  for select using (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_order_items_insert" on public.afterparty_order_items;
create policy "afterparty_order_items_insert" on public.afterparty_order_items
  for insert with check (auth.role() in ('anon', 'authenticated', 'service_role'));

drop policy if exists "afterparty_order_items_update_admin" on public.afterparty_order_items;
create policy "afterparty_order_items_update_admin" on public.afterparty_order_items
  for update using (auth.role() = 'service_role' or public.board_is_admin_user())
  with check (auth.role() = 'service_role' or public.board_is_admin_user());

drop policy if exists "afterparty_receipts_insert" on storage.objects;
create policy "afterparty_receipts_insert" on storage.objects
  for insert with check (
    bucket_id = 'afterparty-receipts'
    and auth.role() in ('anon', 'authenticated', 'service_role')
  );

drop policy if exists "afterparty_receipts_admin_read" on storage.objects;
create policy "afterparty_receipts_admin_read" on storage.objects
  for select using (
    bucket_id = 'afterparty-receipts'
    and (auth.role() = 'service_role' or public.board_is_admin_user())
  );

drop policy if exists "afterparty_receipts_admin_update" on storage.objects;
create policy "afterparty_receipts_admin_update" on storage.objects
  for update using (
    bucket_id = 'afterparty-receipts'
    and (auth.role() = 'service_role' or public.board_is_admin_user())
  ) with check (
    bucket_id = 'afterparty-receipts'
    and (auth.role() = 'service_role' or public.board_is_admin_user())
  );

drop policy if exists "afterparty_receipts_admin_delete" on storage.objects;
create policy "afterparty_receipts_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'afterparty-receipts'
    and (auth.role() = 'service_role' or public.board_is_admin_user())
  );

grant select, insert, update on public.afterparty_participants to anon, authenticated;
grant select, insert on public.afterparty_orders to anon;
grant select, insert, update on public.afterparty_orders to authenticated;
grant select, insert on public.afterparty_order_items to anon;
grant select, insert, update on public.afterparty_order_items to authenticated;
grant select on public.afterparty_individual_leaderboard to anon, authenticated;
grant select on public.afterparty_troop_leaderboard to anon, authenticated;
