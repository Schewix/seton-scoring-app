-- Copy Deskovky judge assignments from one event to another.
-- Source: 2838b776-7866-4212-9c29-acce27e8b103
-- Target: 1c6a4af5-ec6a-4f4f-b0db-96fa6923f5b5

do $$
declare
  source_event_id uuid := '2838b776-7866-4212-9c29-acce27e8b103';
  target_event_id uuid := '1c6a4af5-ec6a-4f4f-b0db-96fa6923f5b5';
  missing_mappings int;
  copied_rows int := 0;
begin
  if not exists (select 1 from public.board_event where id = source_event_id) then
    raise notice 'Skipping board judge assignment copy: source event % not found.', source_event_id;
  elsif not exists (select 1 from public.board_event where id = target_event_id) then
    raise notice 'Skipping board judge assignment copy: target event % not found.', target_event_id;
  else
    -- Guard against partial copy when target event does not contain
    -- matching game/category names.
    with source_pairs as (
      select distinct
        source_game.name as game_name,
        source_category.name as category_name
      from public.board_judge_assignment as assignment
      join public.board_game as source_game on source_game.id = assignment.game_id
      join public.board_category as source_category on source_category.id = assignment.category_id
      where assignment.event_id = source_event_id
        and assignment.category_id is not null
    )
    select count(*) into missing_mappings
    from source_pairs
    where not exists (
      select 1
      from public.board_game as target_game
      join public.board_category as target_category
        on target_category.event_id = target_event_id
       and target_category.name = source_pairs.category_name
      where target_game.event_id = target_event_id
        and target_game.name = source_pairs.game_name
    );

    if missing_mappings > 0 then
      raise notice
        'Skipping board judge assignment copy: target event is missing % game/category mapping(s).',
        missing_mappings;
    else
      -- Replace target assignments so the target event mirrors source event.
      delete from public.board_judge_assignment
      where event_id = target_event_id;

      with source_rows as (
        select
          assignment.user_id,
          assignment.table_number,
          assignment.created_at,
          source_game.name as game_name,
          source_category.name as category_name
        from public.board_judge_assignment as assignment
        join public.board_game as source_game on source_game.id = assignment.game_id
        join public.board_category as source_category on source_category.id = assignment.category_id
        where assignment.event_id = source_event_id
          and assignment.category_id is not null
      ),
      deduplicated as (
        select distinct on (user_id, game_name, category_name)
          user_id,
          table_number,
          game_name,
          category_name
        from source_rows
        order by
          user_id,
          game_name,
          category_name,
          (table_number is not null) desc,
          created_at desc
      )
      insert into public.board_judge_assignment (
        event_id,
        user_id,
        game_id,
        category_id,
        table_number
      )
      select
        target_event_id,
        deduplicated.user_id,
        target_game.id,
        target_category.id,
        deduplicated.table_number
      from deduplicated
      join public.board_game as target_game
        on target_game.event_id = target_event_id
       and target_game.name = deduplicated.game_name
      join public.board_category as target_category
        on target_category.event_id = target_event_id
       and target_category.name = deduplicated.category_name;

      get diagnostics copied_rows = row_count;
      raise notice
        'Copied % board judge assignment rows from event % to %.',
        copied_rows,
        source_event_id,
        target_event_id;
    end if;
  end if;
end $$;
