-- Demo seed for Deskovky module (idempotent baseline data)
-- Usage:
--   supabase db query < supabase/sql/deskovky_demo_seed.sql
-- Notes:
--   1) This creates event/categories/games/blocks/players.
--   2) Judge assignment needs a real judge UUID from public.judges.

insert into public.board_event (id, slug, name, start_date, end_date)
values (
  'd2000000-0000-4000-8000-000000000001',
  'deskovky-2026-demo',
  'Deskové hry 2026 (demo)',
  '2026-06-01',
  '2026-06-02'
)
on conflict (id) do update
set
  slug = excluded.slug,
  name = excluded.name,
  start_date = excluded.start_date,
  end_date = excluded.end_date;

insert into public.board_category (id, event_id, name)
values
  ('d2000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000001', 'Kategorie I + II'),
  ('d2000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000001', 'Kategorie III + IV'),
  ('d2000000-0000-4000-8000-000000000013', 'd2000000-0000-4000-8000-000000000001', 'Kategorie V + VI')
on conflict (id) do update
set
  event_id = excluded.event_id,
  name = excluded.name;

insert into public.board_game (id, event_id, name, scoring_type, points_order, three_player_adjustment, notes)
values
  (
    'd2000000-0000-4000-8000-000000000021',
    'd2000000-0000-4000-8000-000000000001',
    'Dobble',
    'both',
    'asc',
    true,
    'Nižší součet bodů je lepší. U 3 hráčů se použije 0.75 a 1/2.5/4.'
  ),
  (
    'd2000000-0000-4000-8000-000000000022',
    'd2000000-0000-4000-8000-000000000001',
    'Tajná výprava čarodějů',
    'both',
    'desc',
    false,
    'Hlavní hra pro kategorii I + II.'
  ),
  (
    'd2000000-0000-4000-8000-000000000023',
    'd2000000-0000-4000-8000-000000000001',
    'Hop!',
    'both',
    'asc',
    false,
    'Nižší součet zbývajících skoků je lepší.'
  ),
  (
    'd2000000-0000-4000-8000-000000000024',
    'd2000000-0000-4000-8000-000000000001',
    'Ubongo',
    'both',
    'desc',
    false,
    'Vyšší součet bodů je lepší. Hlavní hra pro kategorii III + IV.'
  ),
  (
    'd2000000-0000-4000-8000-000000000025',
    'd2000000-0000-4000-8000-000000000001',
    'Kris kros',
    'both',
    'desc',
    true,
    'Vyšší součet bodů je lepší. Hlavní hra pro kategorii V + VI.'
  ),
  (
    'd2000000-0000-4000-8000-000000000026',
    'd2000000-0000-4000-8000-000000000001',
    'Milostný dopis',
    'both',
    'desc',
    false,
    'Alternativní druhá hra pro kategorii V + VI.'
  ),
  (
    'd2000000-0000-4000-8000-000000000027',
    'd2000000-0000-4000-8000-000000000001',
    'Dominion',
    'both',
    'desc',
    true,
    'Výchozí druhá hra pro kategorii V + VI.'
  )
on conflict (id) do update
set
  event_id = excluded.event_id,
  name = excluded.name,
  scoring_type = excluded.scoring_type,
  points_order = excluded.points_order,
  three_player_adjustment = excluded.three_player_adjustment,
  notes = excluded.notes;

update public.board_category
set primary_game_id = case id
  when 'd2000000-0000-4000-8000-000000000011' then 'd2000000-0000-4000-8000-000000000022'::uuid
  when 'd2000000-0000-4000-8000-000000000012' then 'd2000000-0000-4000-8000-000000000024'::uuid
  when 'd2000000-0000-4000-8000-000000000013' then 'd2000000-0000-4000-8000-000000000025'::uuid
  else primary_game_id
end
where id in (
  'd2000000-0000-4000-8000-000000000011',
  'd2000000-0000-4000-8000-000000000012',
  'd2000000-0000-4000-8000-000000000013'
);

insert into public.board_block (id, event_id, category_id, block_number, game_id)
values
  ('d2000000-0000-4000-8000-000000000031', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000011', 1, 'd2000000-0000-4000-8000-000000000021'),
  ('d2000000-0000-4000-8000-000000000032', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000011', 2, 'd2000000-0000-4000-8000-000000000022'),
  ('d2000000-0000-4000-8000-000000000033', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000012', 1, 'd2000000-0000-4000-8000-000000000023'),
  ('d2000000-0000-4000-8000-000000000034', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000012', 2, 'd2000000-0000-4000-8000-000000000024'),
  ('d2000000-0000-4000-8000-000000000035', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000013', 1, 'd2000000-0000-4000-8000-000000000025'),
  ('d2000000-0000-4000-8000-000000000036', 'd2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000013', 2, 'd2000000-0000-4000-8000-000000000027')
on conflict (id) do update
set
  event_id = excluded.event_id,
  category_id = excluded.category_id,
  block_number = excluded.block_number,
  game_id = excluded.game_id;

insert into public.board_player (id, event_id, short_code, team_name, display_name, category_id)
values
  ('d2000000-0000-4000-8000-000000000101', 'd2000000-0000-4000-8000-000000000001', 'A7K3F2', 'Tým A', 'Hráč A', 'd2000000-0000-4000-8000-000000000011'),
  ('d2000000-0000-4000-8000-000000000102', 'd2000000-0000-4000-8000-000000000001', 'B8L4G3', 'Tým B', 'Hráč B', 'd2000000-0000-4000-8000-000000000011'),
  ('d2000000-0000-4000-8000-000000000103', 'd2000000-0000-4000-8000-000000000001', 'C9M5H4', 'Tým C', 'Hráč C', 'd2000000-0000-4000-8000-000000000011'),
  ('d2000000-0000-4000-8000-000000000104', 'd2000000-0000-4000-8000-000000000001', 'D2N6J5', 'Tým D', 'Hráč D', 'd2000000-0000-4000-8000-000000000011'),
  ('d2000000-0000-4000-8000-000000000105', 'd2000000-0000-4000-8000-000000000001', 'E3P7K6', 'Tým E', 'Hráč E', 'd2000000-0000-4000-8000-000000000012'),
  ('d2000000-0000-4000-8000-000000000106', 'd2000000-0000-4000-8000-000000000001', 'F4Q8L7', 'Tým F', 'Hráč F', 'd2000000-0000-4000-8000-000000000012'),
  ('d2000000-0000-4000-8000-000000000107', 'd2000000-0000-4000-8000-000000000001', 'G5R9M8', 'Tým G', 'Hráč G', 'd2000000-0000-4000-8000-000000000012'),
  ('d2000000-0000-4000-8000-000000000108', 'd2000000-0000-4000-8000-000000000001', 'H6S2N9', 'Tým H', 'Hráč H', 'd2000000-0000-4000-8000-000000000012'),
  ('d2000000-0000-4000-8000-000000000109', 'd2000000-0000-4000-8000-000000000001', 'J7T3P4', 'Tým I', 'Hráč I', 'd2000000-0000-4000-8000-000000000013'),
  ('d2000000-0000-4000-8000-000000000110', 'd2000000-0000-4000-8000-000000000001', 'K8U4Q5', 'Tým J', 'Hráč J', 'd2000000-0000-4000-8000-000000000013'),
  ('d2000000-0000-4000-8000-000000000111', 'd2000000-0000-4000-8000-000000000001', 'L9V5R6', 'Tým K', 'Hráč K', 'd2000000-0000-4000-8000-000000000013'),
  ('d2000000-0000-4000-8000-000000000112', 'd2000000-0000-4000-8000-000000000001', 'M2W6S7', 'Tým L', 'Hráč L', 'd2000000-0000-4000-8000-000000000013')
on conflict (id) do update
set
  event_id = excluded.event_id,
  short_code = excluded.short_code,
  team_name = excluded.team_name,
  display_name = excluded.display_name,
  category_id = excluded.category_id;

-- Optional: assign a real judge UUID to all configured games
-- replace <judge_uuid_here> with an existing public.judges.id
--
-- insert into public.board_judge_assignment (id, event_id, user_id, game_id, category_id)
-- values
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000021', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000022', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000023', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000024', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000025', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000026', null),
--   (gen_random_uuid(), 'd2000000-0000-4000-8000-000000000001', '<judge_uuid_here>', 'd2000000-0000-4000-8000-000000000027', null);
