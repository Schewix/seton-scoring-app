do $$ begin
  create type public.board_scoring_type as enum ('points', 'placement', 'both');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.board_match_status as enum ('submitted', 'void');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.board_points_order as enum ('asc', 'desc');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.board_event (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.board_category (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  name text not null,
  primary_game_id uuid,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create table if not exists public.board_game (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  name text not null,
  scoring_type public.board_scoring_type not null,
  points_order public.board_points_order not null default 'desc',
  three_player_adjustment boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

alter table public.board_game
  add column if not exists points_order public.board_points_order not null default 'desc';

alter table public.board_game
  add column if not exists three_player_adjustment boolean not null default false;

alter table public.board_category
  add column if not exists primary_game_id uuid;

do $$ begin
  alter table public.board_category
    add constraint board_category_primary_game_fk
      foreign key (primary_game_id)
      references public.board_game(id)
      on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.board_block (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  category_id uuid not null references public.board_category(id) on delete cascade,
  block_number int not null check (block_number >= 1),
  game_id uuid not null references public.board_game(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, category_id, block_number)
);

create table if not exists public.board_player (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  short_code text not null,
  team_name text,
  display_name text,
  category_id uuid not null references public.board_category(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, short_code)
);

create table if not exists public.board_badge (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  player_id uuid not null references public.board_player(id) on delete cascade,
  qr_payload text not null,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);

create table if not exists public.board_judge_assignment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  user_id uuid not null references public.judges(id) on delete cascade,
  game_id uuid not null references public.board_game(id) on delete cascade,
  category_id uuid references public.board_category(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id, game_id, category_id)
);

create table if not exists public.board_match (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.board_event(id) on delete cascade,
  category_id uuid not null references public.board_category(id) on delete restrict,
  block_id uuid not null references public.board_block(id) on delete restrict,
  round_number int,
  created_by uuid not null references public.judges(id) on delete restrict,
  created_at timestamptz not null default now(),
  status public.board_match_status not null default 'submitted'
);

create table if not exists public.board_match_player (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.board_match(id) on delete cascade,
  player_id uuid not null references public.board_player(id) on delete restrict,
  seat int not null check (seat between 1 and 4),
  placement numeric,
  points numeric,
  created_at timestamptz not null default now(),
  unique (match_id, player_id),
  unique (match_id, seat),
  check (placement is null or placement > 0)
);

create index if not exists board_category_event_idx on public.board_category(event_id);
create index if not exists board_category_primary_game_idx on public.board_category(primary_game_id);
create index if not exists board_game_event_idx on public.board_game(event_id);
create index if not exists board_block_event_category_idx on public.board_block(event_id, category_id, block_number);
create index if not exists board_block_game_idx on public.board_block(game_id);
create index if not exists board_player_event_short_code_idx on public.board_player(event_id, short_code);
create index if not exists board_player_event_category_idx on public.board_player(event_id, category_id);
create index if not exists board_assignment_event_user_idx on public.board_judge_assignment(event_id, user_id);
create index if not exists board_assignment_event_game_idx on public.board_judge_assignment(event_id, game_id);
create index if not exists board_match_event_category_idx on public.board_match(event_id, category_id);
create index if not exists board_match_block_idx on public.board_match(block_id);
create index if not exists board_match_created_by_idx on public.board_match(created_by);
create index if not exists board_match_player_match_idx on public.board_match_player(match_id);
create index if not exists board_match_player_player_idx on public.board_match_player(player_id);

create or replace function public.board_claim_sub_uuid()
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
  return raw_sub::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function public.board_claim_station_uuid()
returns uuid
language plpgsql
stable
as $$
declare
  raw_station text;
begin
  raw_station := coalesce(
    nullif(auth.jwt()->>'station_id', ''),
    nullif(auth.jwt()->>'stationId', '')
  );
  if raw_station is null then
    return null;
  end if;
  return raw_station::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function public.board_is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stations s
    where s.id = public.board_claim_station_uuid()
      and upper(trim(s.code)) = 'T'
  );
$$;

create or replace function public.board_has_event_assignment(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_judge_assignment a
    where a.event_id = p_event_id
      and a.user_id = public.board_claim_sub_uuid()
  );
$$;

create or replace function public.board_has_game_assignment(
  p_event_id uuid,
  p_game_id uuid,
  p_category_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_judge_assignment a
    where a.event_id = p_event_id
      and a.game_id = p_game_id
      and a.user_id = public.board_claim_sub_uuid()
      and (a.category_id is null or a.category_id = p_category_id)
  );
$$;

create or replace function public.board_can_submit_match(
  p_event_id uuid,
  p_block_id uuid,
  p_category_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.board_is_admin_user()
    or (
      p_created_by = public.board_claim_sub_uuid()
      and exists (
        select 1
        from public.board_block b
        where b.id = p_block_id
          and b.event_id = p_event_id
          and b.category_id = p_category_id
          and public.board_has_game_assignment(p_event_id, b.game_id, p_category_id)
      )
    );
$$;

create or replace function public.board_match_visible(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_match m
    where m.id = p_match_id
      and (
        public.board_is_admin_user()
        or m.created_by = public.board_claim_sub_uuid()
        or public.board_has_event_assignment(m.event_id)
      )
  );
$$;

alter table public.board_event enable row level security;
alter table public.board_category enable row level security;
alter table public.board_game enable row level security;
alter table public.board_block enable row level security;
alter table public.board_player enable row level security;
alter table public.board_badge enable row level security;
alter table public.board_judge_assignment enable row level security;
alter table public.board_match enable row level security;
alter table public.board_match_player enable row level security;

drop policy if exists board_event_select on public.board_event;
create policy board_event_select on public.board_event
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(id));

drop policy if exists board_event_admin_all on public.board_event;
create policy board_event_admin_all on public.board_event
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_category_select on public.board_category;
create policy board_category_select on public.board_category
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(event_id));

drop policy if exists board_category_admin_all on public.board_category;
create policy board_category_admin_all on public.board_category
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_game_select on public.board_game;
create policy board_game_select on public.board_game
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(event_id));

drop policy if exists board_game_admin_all on public.board_game;
create policy board_game_admin_all on public.board_game
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_block_select on public.board_block;
create policy board_block_select on public.board_block
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(event_id));

drop policy if exists board_block_admin_all on public.board_block;
create policy board_block_admin_all on public.board_block
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_player_select on public.board_player;
create policy board_player_select on public.board_player
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(event_id));

drop policy if exists board_player_admin_all on public.board_player;
create policy board_player_admin_all on public.board_player
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_badge_select on public.board_badge;
create policy board_badge_select on public.board_badge
  for select using (public.board_is_admin_user() or public.board_has_event_assignment(event_id));

drop policy if exists board_badge_admin_all on public.board_badge;
create policy board_badge_admin_all on public.board_badge
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_assignment_select on public.board_judge_assignment;
create policy board_assignment_select on public.board_judge_assignment
  for select using (
    public.board_is_admin_user()
    or user_id = public.board_claim_sub_uuid()
    or public.board_has_event_assignment(event_id)
  );

drop policy if exists board_assignment_admin_all on public.board_judge_assignment;
create policy board_assignment_admin_all on public.board_judge_assignment
  for all using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_match_select on public.board_match;
create policy board_match_select on public.board_match
  for select using (
    public.board_is_admin_user()
    or created_by = public.board_claim_sub_uuid()
    or public.board_has_event_assignment(event_id)
  );

drop policy if exists board_match_insert on public.board_match;
create policy board_match_insert on public.board_match
  for insert with check (
    public.board_can_submit_match(event_id, block_id, category_id, created_by)
  );

drop policy if exists board_match_update_admin on public.board_match;
create policy board_match_update_admin on public.board_match
  for update using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_match_delete_admin on public.board_match;
create policy board_match_delete_admin on public.board_match
  for delete using (public.board_is_admin_user());

drop policy if exists board_match_player_select on public.board_match_player;
create policy board_match_player_select on public.board_match_player
  for select using (public.board_match_visible(match_id));

drop policy if exists board_match_player_insert on public.board_match_player;
create policy board_match_player_insert on public.board_match_player
  for insert with check (
    exists (
      select 1
      from public.board_match m
      where m.id = match_id
        and public.board_can_submit_match(m.event_id, m.block_id, m.category_id, m.created_by)
    )
  );

drop policy if exists board_match_player_update_admin on public.board_match_player;
create policy board_match_player_update_admin on public.board_match_player
  for update using (public.board_is_admin_user())
  with check (public.board_is_admin_user());

drop policy if exists board_match_player_delete_admin on public.board_match_player;
create policy board_match_player_delete_admin on public.board_match_player
  for delete using (public.board_is_admin_user());

grant select, insert, update, delete on public.board_event to authenticated;
grant select, insert, update, delete on public.board_category to authenticated;
grant select, insert, update, delete on public.board_game to authenticated;
grant select, insert, update, delete on public.board_block to authenticated;
grant select, insert, update, delete on public.board_player to authenticated;
grant select, insert, update, delete on public.board_badge to authenticated;
grant select, insert, update, delete on public.board_judge_assignment to authenticated;
grant select, insert, update, delete on public.board_match to authenticated;
grant select, insert, update, delete on public.board_match_player to authenticated;
grant select, insert, update, delete on public.board_event to anon;
grant select, insert, update, delete on public.board_category to anon;
grant select, insert, update, delete on public.board_game to anon;
grant select, insert, update, delete on public.board_block to anon;
grant select, insert, update, delete on public.board_player to anon;
grant select, insert, update, delete on public.board_badge to anon;
grant select, insert, update, delete on public.board_judge_assignment to anon;
grant select, insert, update, delete on public.board_match to anon;
grant select, insert, update, delete on public.board_match_player to anon;

create or replace function public.board_points_lower_is_better(
  p_scoring_type public.board_scoring_type,
  p_points_order public.board_points_order
)
returns boolean
language sql
immutable
as $$
  select case
    when p_scoring_type = 'placement' then true
    else p_points_order = 'asc'
  end;
$$;

create or replace view public.board_game_standings
with (security_invoker = true)
as
with per_match as (
  select
    m.event_id,
    m.category_id,
    b.game_id,
    g.name as game_name,
    g.scoring_type,
    g.points_order,
    g.three_player_adjustment,
    mp.match_id,
    mp.player_id,
    count(*) over (partition by mp.match_id) as players_in_match,
    mp.points as points_raw,
    mp.placement as placement_raw
  from public.board_match_player mp
  join public.board_match m on m.id = mp.match_id
  join public.board_block b on b.id = m.block_id
  join public.board_game g on g.id = b.game_id
  where m.status = 'submitted'
),
adjusted as (
  select
    p.event_id,
    p.category_id,
    p.game_id,
    p.game_name,
    p.scoring_type,
    p.points_order,
    p.three_player_adjustment,
    p.match_id,
    p.player_id,
    case
      when p.players_in_match = 3 and p.three_player_adjustment and p.points_raw is not null
        then p.points_raw * 0.75
      else p.points_raw
    end as points_adjusted,
    case
      when p.players_in_match = 3 and p.three_player_adjustment then
        case
          when p.placement_raw = 1 then 1::numeric
          when p.placement_raw = 2 then 2.5::numeric
          when p.placement_raw = 3 then 4::numeric
          else p.placement_raw
        end
      else p.placement_raw
    end as placement_adjusted
  from per_match p
),
per_player as (
  select
    a.event_id,
    a.category_id,
    a.game_id,
    max(a.game_name) as game_name,
    max(a.scoring_type) as scoring_type,
    max(a.points_order) as points_order,
    bool_or(a.three_player_adjustment) as three_player_adjustment,
    a.player_id,
    count(*)::int as matches_played,
    sum(a.points_adjusted) as total_points,
    avg(a.placement_adjusted) as avg_placement,
    min(a.placement_adjusted) as best_placement,
    sum(a.placement_adjusted) as placement_sum,
    min(a.points_adjusted) as min_match_points,
    max(a.points_adjusted) as max_match_points
  from adjusted a
  group by a.event_id, a.category_id, a.game_id, a.player_id
),
ranked_base as (
  select
    p.*,
    public.board_points_lower_is_better(p.scoring_type, p.points_order) as points_lower_is_better,
    coalesce(p.placement_sum, 1e9::numeric) as secondary_value,
    case
      when p.scoring_type = 'placement' then coalesce(p.placement_sum, 1e9::numeric)
      when public.board_points_lower_is_better(p.scoring_type, p.points_order)
        then coalesce(p.total_points, 1e9::numeric)
      else coalesce(p.total_points, -1e9::numeric)
    end as main_value,
    case
      when p.scoring_type = 'placement' then coalesce(p.best_placement, 1e9::numeric)
      when public.board_points_lower_is_better(p.scoring_type, p.points_order)
        then coalesce(p.min_match_points, 1e9::numeric)
      else -coalesce(p.max_match_points, -1e9::numeric)
    end as best_metric_ordered
  from per_player p
),
ranked as (
  select
    r.*,
    rank() over (
      partition by r.event_id, r.category_id, r.game_id
      order by
        case when r.scoring_type = 'placement' or r.points_lower_is_better then r.main_value end asc,
        case when r.scoring_type <> 'placement' and not r.points_lower_is_better then r.main_value end desc,
        r.secondary_value asc,
        r.player_id
    ) as rank_min,
    count(*) over (
      partition by r.event_id, r.category_id, r.game_id, r.main_value, r.secondary_value
    ) as tie_size
  from ranked_base r
)
select
  r.event_id,
  r.category_id,
  r.game_id,
  r.player_id,
  r.matches_played,
  r.total_points,
  r.avg_placement,
  r.best_placement,
  r.placement_sum,
  case
    when r.points_lower_is_better then r.min_match_points
    else r.max_match_points
  end as best_match_points,
  r.game_name,
  r.scoring_type,
  r.points_order,
  r.three_player_adjustment,
  r.best_metric_ordered,
  ((r.rank_min + r.rank_min + r.tie_size - 1)::numeric / 2.0)::numeric(10,2) as game_rank,
  r.rank_min::int as game_rank_min,
  r.tie_size::int as game_tie_size
from ranked r;

create or replace view public.board_overall_standings
with (security_invoker = true)
as
with scoped as (
  select
    s.event_id,
    s.category_id,
    s.player_id,
    s.game_id,
    s.game_name,
    s.game_rank,
    s.total_points,
    s.avg_placement,
    s.best_placement,
    s.best_match_points,
    s.best_metric_ordered,
    c.primary_game_id,
    (c.primary_game_id is not null and s.game_id = c.primary_game_id) as is_primary
  from public.board_game_standings s
  join public.board_category c on c.id = s.category_id
),
per_player as (
  select
    p.event_id,
    p.category_id,
    p.player_id,
    max(p.primary_game_id) as primary_game_id,
    count(*)::int as games_counted,
    sum(p.game_rank)::numeric as overall_score,
    min(p.game_rank) filter (where p.is_primary) as primary_game_rank,
    min(p.best_metric_ordered) filter (where p.is_primary) as primary_best_metric,
    min(p.best_placement) filter (where p.is_primary) as primary_best_placement,
    min(p.best_metric_ordered) filter (where not p.is_primary) as secondary_best_metric,
    min(p.best_placement) filter (where not p.is_primary) as secondary_best_placement,
    jsonb_agg(
      jsonb_build_object(
        'game_id', p.game_id,
        'game_name', p.game_name,
        'is_primary', p.is_primary,
        'game_rank', p.game_rank,
        'total_points', p.total_points,
        'avg_placement', p.avg_placement
      )
      order by
        case when p.is_primary then 0 else 1 end,
        p.game_rank,
        p.game_id
    ) as game_breakdown
  from scoped p
  group by p.event_id, p.category_id, p.player_id
),
scored as (
  select
    p.*,
    coalesce(p.primary_game_rank, 1e9::numeric) as tie_break_primary,
    coalesce(p.primary_best_metric, coalesce(p.secondary_best_metric, 1e9::numeric)) as tie_break_secondary,
    coalesce(p.secondary_best_metric, coalesce(p.primary_best_metric, 1e9::numeric)) as tie_break_tertiary,
    coalesce(p.primary_best_placement, coalesce(p.secondary_best_placement, 1e9::numeric)) as tie_break_quaternary,
    coalesce(p.secondary_best_placement, coalesce(p.primary_best_placement, 1e9::numeric)) as tie_break_quinary
  from per_player p
),
ranked as (
  select
    s.*,
    rank() over (
      partition by s.event_id, s.category_id
      order by
        s.overall_score asc,
        s.tie_break_primary asc,
        s.tie_break_secondary asc,
        s.tie_break_tertiary asc,
        s.tie_break_quaternary asc,
        s.tie_break_quinary asc,
        s.player_id
    ) as rank_min,
    count(*) over (
      partition by
        s.event_id,
        s.category_id,
        s.overall_score,
        s.tie_break_primary,
        s.tie_break_secondary,
        s.tie_break_tertiary,
        s.tie_break_quaternary,
        s.tie_break_quinary
    ) as tie_size
  from scored s
)
select
  r.event_id,
  r.category_id,
  r.player_id,
  r.primary_game_id,
  r.games_counted,
  r.overall_score,
  r.game_breakdown,
  ((r.rank_min + r.rank_min + r.tie_size - 1)::numeric / 2.0)::numeric(10,2) as overall_rank,
  r.rank_min::int as overall_rank_min,
  r.tie_size::int as overall_tie_size
from ranked r;

grant select on public.board_game_standings to authenticated;
grant select on public.board_overall_standings to authenticated;
grant select on public.board_game_standings to anon;
grant select on public.board_overall_standings to anon;
