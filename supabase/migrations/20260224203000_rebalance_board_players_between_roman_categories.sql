-- Rebalance Deskovky players between paired Roman categories.
-- Moves roughly half of players from:
--   Kategorie I   -> Kategorie II
--   Kategorie III -> Kategorie IV
--   Kategorie V   -> Kategorie VI
-- per event, using deterministic pseudo-random ordering by player UUID.

with category_pairs as (
  select
    source_category.id as source_category_id,
    target_category.id as target_category_id
  from (
    values
      ('Kategorie I'::text, 'Kategorie II'::text),
      ('Kategorie III'::text, 'Kategorie IV'::text),
      ('Kategorie V'::text, 'Kategorie VI'::text)
  ) as pair(source_name, target_name)
  join public.board_category as source_category
    on source_category.name = pair.source_name
  join public.board_category as target_category
    on target_category.event_id = source_category.event_id
   and target_category.name = pair.target_name
), ranked_players as (
  select
    player.id as player_id,
    category_pairs.target_category_id,
    row_number() over (
      partition by player.category_id
      order by md5(player.id::text), player.id
    ) as row_num,
    count(*) over (partition by player.category_id) as player_count
  from public.board_player as player
  join category_pairs
    on category_pairs.source_category_id = player.category_id
), players_to_move as (
  select
    ranked_players.player_id,
    ranked_players.target_category_id
  from ranked_players
  where ranked_players.row_num <= (ranked_players.player_count / 2)
)
update public.board_player as player
set category_id = players_to_move.target_category_id
from players_to_move
where player.id = players_to_move.player_id;
