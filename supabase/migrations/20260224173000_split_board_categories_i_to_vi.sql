-- Normalize legacy Deskovky categories from paired labels to individual Roman categories.
-- Legacy labels:
--   Kategorie I + II
--   Kategorie III + IV
--   Kategorie V + VI

-- 1) Rename legacy labels when target label does not exist in the same event.
update public.board_category as c
set name = 'Kategorie I'
where c.name = 'Kategorie I + II'
  and not exists (
    select 1
    from public.board_category as existing
    where existing.event_id = c.event_id
      and existing.name = 'Kategorie I'
  );

update public.board_category as c
set name = 'Kategorie III'
where c.name = 'Kategorie III + IV'
  and not exists (
    select 1
    from public.board_category as existing
    where existing.event_id = c.event_id
      and existing.name = 'Kategorie III'
  );

update public.board_category as c
set name = 'Kategorie V'
where c.name = 'Kategorie V + VI'
  and not exists (
    select 1
    from public.board_category as existing
    where existing.event_id = c.event_id
      and existing.name = 'Kategorie V'
  );

-- 2) Merge legacy duplicate rows when both old and new labels are present.
-- Pair: I + II -> I
with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
), block_conflicts as (
  select legacy_block.id as legacy_block_id, target_block.id as target_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
update public.board_match as m
set block_id = block_conflicts.target_block_id
from block_conflicts
where m.block_id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
), block_conflicts as (
  select legacy_block.id as legacy_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
delete from public.board_block as b
using block_conflicts
where b.id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
update public.board_block as b
set category_id = pair_rows.target_id
from pair_rows
where b.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
update public.board_player as p
set category_id = pair_rows.target_id
from pair_rows
where p.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
update public.board_match as m
set category_id = pair_rows.target_id
from pair_rows
where m.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
delete from public.board_judge_assignment as target
using public.board_judge_assignment as source
join pair_rows on pair_rows.legacy_id = source.category_id
where target.event_id = source.event_id
  and target.user_id = source.user_id
  and target.game_id = source.game_id
  and target.category_id = pair_rows.target_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
update public.board_judge_assignment as a
set category_id = pair_rows.target_id
from pair_rows
where a.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie I'
  where legacy.name = 'Kategorie I + II'
)
delete from public.board_category as c
using pair_rows
where c.id = pair_rows.legacy_id;

-- Pair: III + IV -> III
with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
), block_conflicts as (
  select legacy_block.id as legacy_block_id, target_block.id as target_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
update public.board_match as m
set block_id = block_conflicts.target_block_id
from block_conflicts
where m.block_id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
), block_conflicts as (
  select legacy_block.id as legacy_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
delete from public.board_block as b
using block_conflicts
where b.id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
update public.board_block as b
set category_id = pair_rows.target_id
from pair_rows
where b.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
update public.board_player as p
set category_id = pair_rows.target_id
from pair_rows
where p.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
update public.board_match as m
set category_id = pair_rows.target_id
from pair_rows
where m.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
delete from public.board_judge_assignment as target
using public.board_judge_assignment as source
join pair_rows on pair_rows.legacy_id = source.category_id
where target.event_id = source.event_id
  and target.user_id = source.user_id
  and target.game_id = source.game_id
  and target.category_id = pair_rows.target_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
update public.board_judge_assignment as a
set category_id = pair_rows.target_id
from pair_rows
where a.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie III'
  where legacy.name = 'Kategorie III + IV'
)
delete from public.board_category as c
using pair_rows
where c.id = pair_rows.legacy_id;

-- Pair: V + VI -> V
with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
), block_conflicts as (
  select legacy_block.id as legacy_block_id, target_block.id as target_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
update public.board_match as m
set block_id = block_conflicts.target_block_id
from block_conflicts
where m.block_id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
), block_conflicts as (
  select legacy_block.id as legacy_block_id
  from public.board_block as legacy_block
  join pair_rows on pair_rows.legacy_id = legacy_block.category_id
  join public.board_block as target_block
    on target_block.event_id = legacy_block.event_id
   and target_block.category_id = pair_rows.target_id
   and target_block.block_number = legacy_block.block_number
)
delete from public.board_block as b
using block_conflicts
where b.id = block_conflicts.legacy_block_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
update public.board_block as b
set category_id = pair_rows.target_id
from pair_rows
where b.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
update public.board_player as p
set category_id = pair_rows.target_id
from pair_rows
where p.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
update public.board_match as m
set category_id = pair_rows.target_id
from pair_rows
where m.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
delete from public.board_judge_assignment as target
using public.board_judge_assignment as source
join pair_rows on pair_rows.legacy_id = source.category_id
where target.event_id = source.event_id
  and target.user_id = source.user_id
  and target.game_id = source.game_id
  and target.category_id = pair_rows.target_id;

with pair_rows as (
  select legacy.id as legacy_id, target.id as target_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
update public.board_judge_assignment as a
set category_id = pair_rows.target_id
from pair_rows
where a.category_id = pair_rows.legacy_id;

with pair_rows as (
  select legacy.id as legacy_id
  from public.board_category as legacy
  join public.board_category as target
    on target.event_id = legacy.event_id
   and target.name = 'Kategorie V'
  where legacy.name = 'Kategorie V + VI'
)
delete from public.board_category as c
using pair_rows
where c.id = pair_rows.legacy_id;

-- 3) Ensure all six categories exist for events that use Roman-category naming.
with candidate_events as (
  select distinct c.event_id
  from public.board_category as c
  where c.name in (
    'Kategorie I',
    'Kategorie II',
    'Kategorie III',
    'Kategorie IV',
    'Kategorie V',
    'Kategorie VI'
  )
), base_primary as (
  select
    e.event_id,
    max(case when c.name in ('Kategorie I', 'Kategorie II') then c.primary_game_id end) as game_i_ii,
    max(case when c.name in ('Kategorie III', 'Kategorie IV') then c.primary_game_id end) as game_iii_iv,
    max(case when c.name in ('Kategorie V', 'Kategorie VI') then c.primary_game_id end) as game_v_vi
  from candidate_events as e
  left join public.board_category as c on c.event_id = e.event_id
  group by e.event_id
), desired as (
  select event_id, 'Kategorie I'::text as name, game_i_ii as primary_game_id from base_primary
  union all
  select event_id, 'Kategorie II'::text as name, game_i_ii as primary_game_id from base_primary
  union all
  select event_id, 'Kategorie III'::text as name, game_iii_iv as primary_game_id from base_primary
  union all
  select event_id, 'Kategorie IV'::text as name, game_iii_iv as primary_game_id from base_primary
  union all
  select event_id, 'Kategorie V'::text as name, game_v_vi as primary_game_id from base_primary
  union all
  select event_id, 'Kategorie VI'::text as name, game_v_vi as primary_game_id from base_primary
)
insert into public.board_category (event_id, name, primary_game_id)
select d.event_id, d.name, d.primary_game_id
from desired as d
on conflict (event_id, name) do update
set primary_game_id = coalesce(board_category.primary_game_id, excluded.primary_game_id);

-- 4) Clone blocks and category-scoped judge assignments to sibling categories.
with sibling_map(source_name, target_name) as (
  values
    ('Kategorie I'::text, 'Kategorie II'::text),
    ('Kategorie III'::text, 'Kategorie IV'::text),
    ('Kategorie V'::text, 'Kategorie VI'::text)
)
insert into public.board_block (event_id, category_id, block_number, game_id)
select
  source.event_id,
  target.id,
  b.block_number,
  b.game_id
from sibling_map
join public.board_category as source on source.name = sibling_map.source_name
join public.board_category as target
  on target.event_id = source.event_id
 and target.name = sibling_map.target_name
join public.board_block as b on b.category_id = source.id
on conflict (event_id, category_id, block_number) do nothing;

with sibling_map(source_name, target_name) as (
  values
    ('Kategorie I'::text, 'Kategorie II'::text),
    ('Kategorie III'::text, 'Kategorie IV'::text),
    ('Kategorie V'::text, 'Kategorie VI'::text)
)
insert into public.board_judge_assignment (event_id, user_id, game_id, category_id)
select
  a.event_id,
  a.user_id,
  a.game_id,
  target.id
from sibling_map
join public.board_category as source on source.name = sibling_map.source_name
join public.board_category as target
  on target.event_id = source.event_id
 and target.name = sibling_map.target_name
join public.board_judge_assignment as a on a.category_id = source.id
on conflict (event_id, user_id, game_id, category_id) do nothing;
