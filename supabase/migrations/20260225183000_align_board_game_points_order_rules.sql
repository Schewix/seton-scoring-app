-- Align points direction per board-game rules used in Deskovky.
with normalized as (
  select
    g.id,
    regexp_replace(
      lower(
        translate(
          g.name,
          'áäčďéěëíïňóöřšťúůüýÿžľĺ',
          'aacdeeeiinoorstuuuyyzll'
        )
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ) as game_key
  from public.board_game g
), targets as (
  select
    n.id,
    case
      when n.game_key in ('tajnavypravacarodeju', 'dobble', 'hop')
        then 'asc'::public.board_points_order
      when n.game_key in ('ubongo', 'kriskros', 'dominion', 'milostnydopis', 'loveletter')
        then 'desc'::public.board_points_order
      else null
    end as points_order
  from normalized n
)
update public.board_game g
set points_order = t.points_order
from targets t
where g.id = t.id
  and t.points_order is not null
  and g.points_order is distinct from t.points_order;
