-- Expand Deskovky judge assignments with NULL category_id to concrete categories
-- based on games configured in board_block.
--
-- Result:
-- - one assignment row per (event, user, game, playable category)
-- - table numbers are preserved when possible
-- - conflicting table numbers are reassigned above current max in that scope

with playable_categories as (
  select distinct
    b.event_id,
    b.game_id,
    b.category_id
  from public.board_block as b
),
source_null as (
  select
    a.id,
    a.event_id,
    a.user_id,
    a.game_id,
    a.table_number,
    a.created_at
  from public.board_judge_assignment as a
  where a.category_id is null
),
expanded_source as (
  select
    s.id as source_id,
    s.event_id,
    s.user_id,
    s.game_id,
    p.category_id,
    s.table_number,
    s.created_at
  from source_null as s
  join playable_categories as p
    on p.event_id = s.event_id
   and p.game_id = s.game_id
),
dedup_source as (
  select distinct on (event_id, user_id, game_id, category_id)
    source_id,
    event_id,
    user_id,
    game_id,
    category_id,
    table_number,
    created_at
  from expanded_source
  order by
    event_id,
    user_id,
    game_id,
    category_id,
    (table_number is not null) desc,
    created_at desc
),
existing_non_null as (
  select
    a.event_id,
    a.game_id,
    a.category_id,
    a.table_number
  from public.board_judge_assignment as a
  where a.category_id is not null
    and a.table_number is not null
),
prepared as (
  select
    d.*,
    case
      when d.table_number is null then null
      when exists (
        select 1
        from existing_non_null as e
        where e.event_id = d.event_id
          and e.game_id = d.game_id
          and e.category_id = d.category_id
          and e.table_number = d.table_number
      ) then null
      else row_number() over (
        partition by d.event_id, d.game_id, d.category_id, d.table_number
        order by d.created_at, d.user_id
      )
    end as preferred_rank
  from dedup_source as d
),
preferred_kept as (
  select
    p.event_id,
    p.user_id,
    p.game_id,
    p.category_id,
    p.table_number,
    p.created_at
  from prepared as p
  where p.table_number is not null
    and p.preferred_rank = 1
),
overflow_candidates as (
  select
    p.event_id,
    p.user_id,
    p.game_id,
    p.category_id,
    p.table_number,
    p.created_at,
    row_number() over (
      partition by p.event_id, p.game_id, p.category_id
      order by p.created_at, p.user_id
    ) as overflow_rank
  from prepared as p
  where p.table_number is not null
    and coalesce(p.preferred_rank, 0) <> 1
),
overflow_start as (
  select
    x.event_id,
    x.game_id,
    x.category_id,
    greatest(
      coalesce((
        select max(e.table_number)
        from existing_non_null as e
        where e.event_id = x.event_id
          and e.game_id = x.game_id
          and e.category_id = x.category_id
      ), 0),
      coalesce((
        select max(k.table_number)
        from preferred_kept as k
        where k.event_id = x.event_id
          and k.game_id = x.game_id
          and k.category_id = x.category_id
      ), 0)
    ) as base_table
  from (
    select distinct
      event_id,
      game_id,
      category_id
    from overflow_candidates
  ) as x
),
final_rows as (
  select
    p.event_id,
    p.user_id,
    p.game_id,
    p.category_id,
    null::int as table_number
  from prepared as p
  where p.table_number is null

  union all

  select
    k.event_id,
    k.user_id,
    k.game_id,
    k.category_id,
    k.table_number
  from preferred_kept as k

  union all

  select
    o.event_id,
    o.user_id,
    o.game_id,
    o.category_id,
    s.base_table + o.overflow_rank as table_number
  from overflow_candidates as o
  join overflow_start as s
    on s.event_id = o.event_id
   and s.game_id = o.game_id
   and s.category_id = o.category_id
)
insert into public.board_judge_assignment (
  event_id,
  user_id,
  game_id,
  category_id,
  table_number
)
select
  f.event_id,
  f.user_id,
  f.game_id,
  f.category_id,
  f.table_number
from final_rows as f
on conflict (event_id, user_id, game_id, category_id) do update
set table_number = coalesce(public.board_judge_assignment.table_number, excluded.table_number);

delete from public.board_judge_assignment as a
where a.category_id is null
  and exists (
    select 1
    from public.board_block as b
    where b.event_id = a.event_id
      and b.game_id = a.game_id
  );
