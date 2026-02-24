-- For now we do not use "Milostny dopis" as a separate game.
-- Keep scoring aligned with Dominion by migrating references to Dominion.

-- 1) If an event has only "Milostny dopis", rename it to "Dominion".
update public.board_game as g
set
  name = 'Dominion',
  scoring_type = 'both'::public.board_scoring_type,
  points_order = 'desc'::public.board_points_order,
  three_player_adjustment = true,
  notes = coalesce(nullif(g.notes, ''), 'Vychozi druha hra pro kategorii V a VI.')
where g.name = 'Milostný dopis'
  and not exists (
    select 1
    from public.board_game as existing
    where existing.event_id = g.event_id
      and existing.name = 'Dominion'
  );

-- 2) For events that still have both rows, migrate references from
-- "Milostny dopis" -> "Dominion".
with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id,
    target.id as target_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
delete from public.board_judge_assignment as source_assignment
using public.board_judge_assignment as target_assignment, game_pairs
where source_assignment.event_id = game_pairs.event_id
  and source_assignment.game_id = game_pairs.source_game_id
  and target_assignment.event_id = game_pairs.event_id
  and target_assignment.game_id = game_pairs.target_game_id
  and source_assignment.user_id = target_assignment.user_id
  and source_assignment.category_id is not distinct from target_assignment.category_id;

with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id,
    target.id as target_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
delete from public.board_judge_assignment as source_assignment
using public.board_judge_assignment as target_assignment, game_pairs
where source_assignment.event_id = game_pairs.event_id
  and source_assignment.game_id = game_pairs.source_game_id
  and source_assignment.table_number is not null
  and target_assignment.event_id = game_pairs.event_id
  and target_assignment.game_id = game_pairs.target_game_id
  and target_assignment.table_number = source_assignment.table_number
  and source_assignment.category_id is not distinct from target_assignment.category_id;

with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id,
    target.id as target_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
update public.board_judge_assignment as assignment
set game_id = game_pairs.target_game_id
from game_pairs
where assignment.event_id = game_pairs.event_id
  and assignment.game_id = game_pairs.source_game_id;

with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id,
    target.id as target_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
update public.board_block as block
set game_id = game_pairs.target_game_id
from game_pairs
where block.event_id = game_pairs.event_id
  and block.game_id = game_pairs.source_game_id;

with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id,
    target.id as target_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
update public.board_category as category
set primary_game_id = game_pairs.target_game_id
from game_pairs
where category.event_id = game_pairs.event_id
  and category.primary_game_id = game_pairs.source_game_id;

-- 3) Remove now-unused "Milostny dopis" rows where safe.
with game_pairs as (
  select
    source.event_id,
    source.id as source_game_id
  from public.board_game as source
  join public.board_game as target
    on target.event_id = source.event_id
   and target.name = 'Dominion'
  where source.name = 'Milostný dopis'
    and source.id <> target.id
)
delete from public.board_game as source
using game_pairs
where source.event_id = game_pairs.event_id
  and source.id = game_pairs.source_game_id
  and not exists (
    select 1
    from public.board_block as block
    where block.game_id = source.id
  )
  and not exists (
    select 1
    from public.board_judge_assignment as assignment
    where assignment.game_id = source.id
  )
  and not exists (
    select 1
    from public.board_category as category
    where category.primary_game_id = source.id
  );
