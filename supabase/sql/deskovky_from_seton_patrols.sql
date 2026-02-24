-- Import Deskovky hráčů ze Seton hlídek + rozlosování partií po 4 (s fallbackem na 3/2/1)
-- Spuštění:
--   supabase db query < supabase/sql/deskovky_from_seton_patrols.sql
--
-- Po spuštění vzniknou/aktualizují se:
--   board_event, board_category, board_game, board_block, board_player, board_badge
--
-- A navíc dočasná tabulka:
--   tmp_deskovky_draw
-- kterou můžeš vyexportovat:
--   select * from tmp_deskovky_draw order by category_name, game_name, round_number, table_number, seat;
--
-- Konfigurace:
-- 1) seton_event_id_override:
--    - null => použije se nejnovější event z public.events
--    - uuid => explicitní Seton event
-- 2) v_vi_secondary_game:
--    - aktualne pouzivej 'Dominion'
--    - hodnota 'Milostny dopis' se automaticky prevede na 'Dominion'
-- 3) rounds_per_block:
--    - počet nalosovaných partií na každý blok/hru

select
  e.slug,
  e.name,
  j.email,
  g.name as game,
  c.name as category
from board_judge_assignment a
join board_event e on e.id = a.event_id
join judges j on j.id = a.user_id
join board_game g on g.id = a.game_id
left join board_category c on c.id = a.category_id
order by e.created_at desc, j.email, g.name;
delete from board_judge_assignment
where event_id = '2838b776-7866-4212-9c29-acce27e8b103';



drop table if exists tmp_deskovky_cfg;
create temporary table tmp_deskovky_cfg as
select
  null::uuid as seton_event_id_override,
  'deskovky-2026'::text as board_event_slug,
  null::text as board_event_name_override,
  'Dominion'::text as v_vi_secondary_game,
  4::int as rounds_per_block;

drop table if exists tmp_deskovky_source_event;
create temporary table tmp_deskovky_source_event as
with cfg as (
  select * from tmp_deskovky_cfg
),
resolved as (
  select
    coalesce(
      cfg.seton_event_id_override,
      (
        select e.id
        from public.events e
        order by e.starts_at desc nulls last, e.ends_at desc nulls last, e.name asc
        limit 1
      )
    ) as seton_event_id,
    cfg.board_event_slug,
    cfg.board_event_name_override,
    cfg.v_vi_secondary_game,
    greatest(cfg.rounds_per_block, 1) as rounds_per_block
  from cfg
)
select
  r.seton_event_id,
  e.name as seton_event_name,
  e.starts_at::date as starts_on,
  e.ends_at::date as ends_on,
  r.board_event_slug,
  coalesce(
    nullif(trim(r.board_event_name_override), ''),
    format('Deskové hry | %s', e.name)
  ) as board_event_name,
  case
    when lower(trim(r.v_vi_secondary_game)) in ('milostny dopis', 'milostný dopis', 'love letter')
      then 'Dominion'
    else r.v_vi_secondary_game
  end as v_vi_secondary_game,
  r.rounds_per_block
from resolved r
join public.events e on e.id = r.seton_event_id;

do $$
begin
  if not exists (select 1 from tmp_deskovky_source_event) then
    raise exception 'Nenalezen Seton event. Nastav seton_event_id_override v tmp_deskovky_cfg.';
  end if;
end $$;

insert into public.board_event (slug, name, start_date, end_date)
select
  se.board_event_slug,
  se.board_event_name,
  se.starts_on,
  se.ends_on
from tmp_deskovky_source_event se
on conflict (slug) do update
set
  name = excluded.name,
  start_date = excluded.start_date,
  end_date = excluded.end_date;

drop table if exists tmp_deskovky_board_event;
create temporary table tmp_deskovky_board_event as
select
  be.id as board_event_id,
  se.seton_event_id,
  se.seton_event_name,
  se.v_vi_secondary_game,
  se.rounds_per_block
from tmp_deskovky_source_event se
join public.board_event be on be.slug = se.board_event_slug;

insert into public.board_category (event_id, name)
select
  b.board_event_id,
  c.name
from tmp_deskovky_board_event b
cross join (
  values
    ('Kategorie I'),
    ('Kategorie II'),
    ('Kategorie III'),
    ('Kategorie IV'),
    ('Kategorie V'),
    ('Kategorie VI')
) as c(name)
on conflict (event_id, name) do nothing;

with game_src as (
  select *
  from (
    values
      (
        'Dobble',
        'both',
        'asc',
        true,
        'Nižší součet bodů je lepší. U 3 hráčů se použije 0.75 a pořadí 1/2.5/4.'
      ),
      (
        'Tajná výprava čarodějů',
        'both',
        'desc',
        false,
        'Hlavní hra pro kategorii I a II.'
      ),
      (
        'Hop!',
        'both',
        'asc',
        false,
        'Nižší součet zbývajících skoků je lepší.'
      ),
      (
        'Ubongo',
        'both',
        'desc',
        false,
        'Vyšší součet bodů je lepší. Hlavní hra pro kategorii III a IV.'
      ),
      (
        'Kris kros',
        'both',
        'desc',
        true,
        'Vyšší součet bodů je lepší. Hlavní hra pro kategorii V a VI.'
      ),
      (
        'Dominion',
        'both',
        'desc',
        true,
        'Výchozí druhá hra pro kategorii V a VI.'
      )
  ) as g(name, scoring_type, points_order, three_player_adjustment, notes)
)
insert into public.board_game (
  event_id,
  name,
  scoring_type,
  points_order,
  three_player_adjustment,
  notes
)
select
  b.board_event_id,
  g.name,
  g.scoring_type::public.board_scoring_type,
  g.points_order::public.board_points_order,
  g.three_player_adjustment,
  g.notes
from tmp_deskovky_board_event b
cross join game_src g
on conflict (event_id, name) do update
set
  scoring_type = excluded.scoring_type,
  points_order = excluded.points_order,
  three_player_adjustment = excluded.three_player_adjustment,
  notes = excluded.notes;

do $$
declare
  selected_game text;
begin
  select v_vi_secondary_game into selected_game
  from tmp_deskovky_board_event
  limit 1;

  if not exists (
    select 1
    from public.board_game g
    join tmp_deskovky_board_event b on b.board_event_id = g.event_id
    where g.name = selected_game
  ) then
    raise exception
      'Sekundarni hra "%" neexistuje. Pouzij "Dominion".',
      selected_game;
  end if;
end $$;

with primary_map as (
  select *
  from (
    values
      ('Kategorie I', 'Tajná výprava čarodějů'),
      ('Kategorie II', 'Tajná výprava čarodějů'),
      ('Kategorie III', 'Ubongo'),
      ('Kategorie IV', 'Ubongo'),
      ('Kategorie V', 'Kris kros'),
      ('Kategorie VI', 'Kris kros')
  ) as pm(category_name, game_name)
)
update public.board_category c
set primary_game_id = g.id
from tmp_deskovky_board_event b
join primary_map pm on true
join public.board_game g on g.event_id = b.board_event_id and g.name = pm.game_name
where c.event_id = b.board_event_id
  and c.name = pm.category_name
  and c.primary_game_id is distinct from g.id;

with fixed_blocks as (
  select *
  from (
    values
      ('Kategorie I', 1, 'Dobble'),
      ('Kategorie I', 2, 'Tajná výprava čarodějů'),
      ('Kategorie II', 1, 'Dobble'),
      ('Kategorie II', 2, 'Tajná výprava čarodějů'),
      ('Kategorie III', 1, 'Hop!'),
      ('Kategorie III', 2, 'Ubongo'),
      ('Kategorie IV', 1, 'Hop!'),
      ('Kategorie IV', 2, 'Ubongo'),
      ('Kategorie V', 1, 'Kris kros'),
      ('Kategorie VI', 1, 'Kris kros')
  ) as fb(category_name, block_number, game_name)
),
block_src as (
  select * from fixed_blocks
  union all
  select
    c.category_name,
    2::int as block_number,
    b.v_vi_secondary_game as game_name
  from tmp_deskovky_board_event b
  cross join (
    values
      ('Kategorie V'::text),
      ('Kategorie VI'::text)
  ) as c(category_name)
)
insert into public.board_block (event_id, category_id, block_number, game_id)
select
  b.board_event_id,
  c.id,
  bs.block_number,
  g.id
from tmp_deskovky_board_event b
join block_src bs on true
join public.board_category c on c.event_id = b.board_event_id and c.name = bs.category_name
join public.board_game g on g.event_id = b.board_event_id and g.name = bs.game_name
on conflict (event_id, category_id, block_number) do update
set game_id = excluded.game_id;

drop table if exists tmp_deskovky_generated_players;
create temporary table tmp_deskovky_generated_players as
with patrol_src as (
  select
    p.id as patrol_id,
    p.team_name,
    p.patrol_code,
    p.category::text as seton_category,
    p.note
  from public.patrols p
  join tmp_deskovky_board_event b on b.seton_event_id = p.event_id
  where p.active is true
),
member_lines as (
  select
    ps.*,
    coalesce(
      nullif(trim(split_part(coalesce(ps.note, ''), E'\n', 1)), ''),
      nullif(trim(coalesce(ps.note, '')), '')
    ) as members_line
  from patrol_src ps
),
parsed_members as (
  select
    ml.patrol_id,
    ml.team_name,
    ml.patrol_code,
    ml.seton_category,
    m.member_index::int as member_index,
    nullif(
      trim(
        regexp_replace(
          regexp_replace(m.member_raw, E'\\s*\\([^)]*\\)\\s*$', '', 'g'),
          E'\\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as display_name
  from member_lines ml
  cross join lateral regexp_split_to_table(
    coalesce(ml.members_line, ''),
    E'\\s*[;,]+\\s*'
  ) with ordinality as m(member_raw, member_index)
),
cleaned_members as (
  select *
  from parsed_members
  where display_name is not null
),
fallback_members as (
  select
    ml.patrol_id,
    ml.team_name,
    ml.patrol_code,
    ml.seton_category,
    1 as member_index,
    format('Člen hlídky %s', ml.patrol_code) as display_name
  from member_lines ml
  where not exists (
    select 1
    from cleaned_members cm
    where cm.patrol_id = ml.patrol_id
  )
),
members as (
  select * from cleaned_members
  union all
  select * from fallback_members
),
mapped as (
  select
    m.*,
    case
      when m.seton_category = 'N' then 'Kategorie I'
      when m.seton_category = 'M' then 'Kategorie II'
      when m.seton_category = 'S' then (array['Kategorie III', 'Kategorie IV'])[(abs(hashtext(m.patrol_code)) % 2) + 1]
      when m.seton_category = 'R' then (array['Kategorie V', 'Kategorie VI'])[(abs(hashtext(m.patrol_code)) % 2) + 1]
      else (array['Kategorie I', 'Kategorie II', 'Kategorie III', 'Kategorie IV', 'Kategorie V', 'Kategorie VI'])[(abs(hashtext(m.patrol_code)) % 6) + 1]
    end as board_category_name
  from members m
),
prepared as (
  select
    b.board_event_id as event_id,
    c.id as category_id,
    m.team_name,
    m.display_name,
    upper(
      left(
        concat(
          'ZL',
          substr(md5(m.patrol_id::text), 1, 8),
          lpad(m.member_index::text, 2, '0'),
          regexp_replace(m.patrol_code, '[^A-Za-z0-9]', '', 'g')
        ),
        24
      )
    ) as short_code
  from mapped m
  join tmp_deskovky_board_event b on true
  join public.board_category c on c.event_id = b.board_event_id and c.name = m.board_category_name
)
select
  p.event_id,
  p.short_code,
  p.team_name,
  p.display_name,
  p.category_id
from prepared p;

insert into public.board_player (
  event_id,
  short_code,
  team_name,
  display_name,
  category_id
)
select
  gp.event_id,
  gp.short_code,
  gp.team_name,
  gp.display_name,
  gp.category_id
from tmp_deskovky_generated_players gp
on conflict (event_id, short_code) do update
set
  team_name = excluded.team_name,
  display_name = excluded.display_name,
  category_id = excluded.category_id;

insert into public.board_badge (event_id, player_id, qr_payload)
select
  p.event_id,
  p.id,
  format('https://zelenaliga.cz/deskovky/p/%s', p.short_code)
from public.board_player p
join tmp_deskovky_board_event b on b.board_event_id = p.event_id
on conflict (event_id, player_id) do update
set qr_payload = excluded.qr_payload;

drop table if exists tmp_deskovky_draw;
create temporary table tmp_deskovky_draw as
with cfg as (
  select board_event_id, rounds_per_block
  from tmp_deskovky_board_event
),
blocks as (
  select
    b.id as block_id,
    b.event_id,
    b.category_id,
    c.name as category_name,
    b.block_number,
    b.game_id,
    g.name as game_name,
    g.three_player_adjustment
  from public.board_block b
  join cfg on cfg.board_event_id = b.event_id
  join public.board_category c on c.id = b.category_id
  join public.board_game g on g.id = b.game_id
),
players as (
  select
    p.id as player_id,
    p.event_id,
    p.category_id,
    p.short_code,
    coalesce(nullif(trim(p.display_name), ''), p.short_code) as display_name,
    coalesce(nullif(trim(p.team_name), ''), '—') as team_name
  from public.board_player p
  join cfg on cfg.board_event_id = p.event_id
),
rounds as (
  select
    bl.*,
    gs as round_number
  from blocks bl
  join cfg on true
  cross join generate_series(1, cfg.rounds_per_block) as gs
),
ranked as (
  select
    r.event_id,
    r.category_id,
    r.category_name,
    r.block_id,
    r.block_number,
    r.game_id,
    r.game_name,
    r.three_player_adjustment,
    r.round_number,
    p.player_id,
    p.short_code,
    p.display_name,
    p.team_name,
    row_number() over (
      partition by r.block_id, r.round_number
      order by md5(p.player_id::text || ':' || r.block_id::text || ':' || r.round_number::text)
    ) as rn,
    count(*) over (partition by r.block_id, r.round_number) as player_count
  from rounds r
  join players p on p.event_id = r.event_id and p.category_id = r.category_id
),
round_stats as (
  select distinct
    r.block_id,
    r.round_number,
    r.player_count,
    case
      when r.player_count <= 0 then 0
      when mod(r.player_count, 4) = 0 then r.player_count / 4
      when mod(r.player_count, 4) = 1 and r.player_count >= 9 then (r.player_count - 9) / 4
      when mod(r.player_count, 4) = 2 and r.player_count >= 6 then (r.player_count - 6) / 4
      when mod(r.player_count, 4) = 3 then (r.player_count - 3) / 4
      else 0
    end as tables_of_4,
    case
      when r.player_count <= 0 then 0
      when mod(r.player_count, 4) = 0 then 0
      when mod(r.player_count, 4) = 1 and r.player_count >= 9 then 3
      when mod(r.player_count, 4) = 1 and r.player_count = 5 then 1
      when mod(r.player_count, 4) = 2 and r.player_count >= 6 then 2
      when mod(r.player_count, 4) = 3 then 1
      else 0
    end as tables_of_3,
    case
      when r.player_count = 1 then 1
      when r.player_count = 2 then 1
      when r.player_count = 5 then 1
      else 0
    end as tables_extra,
    case
      when r.player_count = 1 then 1
      when r.player_count = 2 then 2
      when r.player_count = 5 then 2
      else 0
    end as extra_table_size
  from ranked r
),
table_sizes as (
  select
    rs.block_id,
    rs.round_number,
    gs as table_number,
    4 as table_size
  from round_stats rs
  cross join lateral generate_series(1, rs.tables_of_4) as gs
  union all
  select
    rs.block_id,
    rs.round_number,
    rs.tables_of_4 + gs as table_number,
    3 as table_size
  from round_stats rs
  cross join lateral generate_series(1, rs.tables_of_3) as gs
  union all
  select
    rs.block_id,
    rs.round_number,
    rs.tables_of_4 + rs.tables_of_3 + 1 as table_number,
    rs.extra_table_size as table_size
  from round_stats rs
  where rs.tables_extra = 1
),
table_ranges as (
  select
    ts.block_id,
    ts.round_number,
    ts.table_number,
    ts.table_size,
    coalesce(
      sum(ts.table_size) over (
        partition by ts.block_id, ts.round_number
        order by ts.table_number
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) + 1 as start_rn,
    sum(ts.table_size) over (
      partition by ts.block_id, ts.round_number
      order by ts.table_number
      rows between unbounded preceding and current row
    ) as end_rn
  from table_sizes ts
),
assigned as (
  select
    r.event_id,
    r.category_id,
    r.category_name,
    r.block_id,
    r.block_number,
    r.game_id,
    r.game_name,
    r.three_player_adjustment,
    r.round_number,
    tr.table_number,
    tr.table_size,
    (r.rn - tr.start_rn + 1) as seat,
    r.player_id,
    r.short_code,
    r.display_name,
    r.team_name
  from ranked r
  join table_ranges tr
    on tr.block_id = r.block_id
   and tr.round_number = r.round_number
   and r.rn between tr.start_rn and tr.end_rn
)
select
  a.event_id,
  a.category_id,
  a.category_name,
  a.block_id,
  a.block_number,
  a.game_id,
  a.game_name,
  a.round_number,
  a.table_number,
  a.table_size,
  a.seat,
  a.player_id,
  a.short_code,
  a.display_name,
  a.team_name,
  a.three_player_adjustment
from assigned a
order by
  a.category_name,
  a.game_name,
  a.round_number,
  a.table_number,
  a.seat;

-- Shrnutí importu hráčů
select
  c.name as category_name,
  count(*) as players
from public.board_player p
join tmp_deskovky_board_event b on b.board_event_id = p.event_id
join public.board_category c on c.id = p.category_id
group by c.name
order by c.name;

-- Rozlosování k exportu (partie po blocích)
select
  d.category_name,
  d.game_name,
  d.round_number,
  d.table_number,
  d.table_size,
  d.seat,
  d.short_code,
  d.display_name,
  d.team_name
from tmp_deskovky_draw d
order by
  d.category_name,
  d.game_name,
  d.round_number,
  d.table_number,
  d.seat;

-- Kontrola: kde vznikly stoly o 3 hráčích bez aktivní 3P úpravy
select distinct
  d.category_name,
  d.game_name,
  d.round_number,
  d.table_number,
  d.table_size
from tmp_deskovky_draw d
where d.table_size = 3
  and d.three_player_adjustment is false
order by
  d.category_name,
  d.game_name,
  d.round_number,
  d.table_number;
