-- Backfill missing deskovky table assignments for judges.
-- First missing table in each (event, game, category) scope starts at 25.
-- Additional missing rows in the same scope get 26, 27, ...

with ranked_missing as (
  select
    assignment.id,
    greatest(
      24,
      coalesce(existing.max_table_number, 24)
    ) as base_table_number,
    row_number() over (
      partition by assignment.event_id, assignment.game_id, assignment.category_id
      order by assignment.created_at, assignment.id
    ) as row_num
  from public.board_judge_assignment as assignment
  left join lateral (
    select max(other.table_number) as max_table_number
    from public.board_judge_assignment as other
    where other.event_id = assignment.event_id
      and other.game_id = assignment.game_id
      and other.category_id is not distinct from assignment.category_id
      and other.table_number is not null
  ) as existing on true
  where assignment.table_number is null
)
update public.board_judge_assignment as assignment
set table_number = ranked_missing.base_table_number + ranked_missing.row_num
from ranked_missing
where assignment.id = ranked_missing.id;
