-- Copy Deskovky judge assignments between events, including rows with NULL category.
-- Source: 2838b776-7866-4212-9c29-acce27e8b103
-- Target: 1c6a4af5-ec6a-4f4f-b0db-96fa6923f5b5

do $$
declare
  source_event_id uuid := '2838b776-7866-4212-9c29-acce27e8b103';
  target_event_id uuid := '1c6a4af5-ec6a-4f4f-b0db-96fa6923f5b5';
  missing_games int;
  missing_categories int;
  copied_rows int := 0;
begin
  if not exists (select 1 from public.board_event where id = source_event_id) then
    raise notice 'Skipping board judge assignment copy (NULL categories): source event % not found.', source_event_id;
  elsif not exists (select 1 from public.board_event where id = target_event_id) then
    raise notice 'Skipping board judge assignment copy (NULL categories): target event % not found.', target_event_id;
  else
    with source_game_names as (
      select distinct source_game.name as game_name
      from public.board_judge_assignment as assignment
      join public.board_game as source_game on source_game.id = assignment.game_id
      where assignment.event_id = source_event_id
    )
    select count(*) into missing_games
    from source_game_names
    where not exists (
      select 1
      from public.board_game as target_game
      where target_game.event_id = target_event_id
        and target_game.name = source_game_names.game_name
    );

    if missing_games > 0 then
      raise notice
        'Skipping board judge assignment copy (NULL categories): target event is missing % game(s).',
        missing_games;
    else
      with source_category_names as (
        select distinct source_category.name as category_name
        from public.board_judge_assignment as assignment
        join public.board_category as source_category on source_category.id = assignment.category_id
        where assignment.event_id = source_event_id
          and assignment.category_id is not null
      )
      select count(*) into missing_categories
      from source_category_names
      where not exists (
        select 1
        from public.board_category as target_category
        where target_category.event_id = target_event_id
          and target_category.name = source_category_names.category_name
      );

      if missing_categories > 0 then
        raise notice
          'Skipping board judge assignment copy (NULL categories): target event is missing % category mapping(s).',
          missing_categories;
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
          left join public.board_category as source_category on source_category.id = assignment.category_id
          where assignment.event_id = source_event_id
        ),
        deduplicated as (
          select distinct on (
            user_id,
            game_name,
            coalesce(category_name, '__NULL__')
          )
            user_id,
            table_number,
            game_name,
            category_name
          from source_rows
          order by
            user_id,
            game_name,
            coalesce(category_name, '__NULL__'),
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
        left join public.board_category as target_category
          on target_category.event_id = target_event_id
         and target_category.name = deduplicated.category_name;

        get diagnostics copied_rows = row_count;
        raise notice
          'Copied % board judge assignment rows (including NULL categories) from event % to %.',
          copied_rows,
          source_event_id,
          target_event_id;
      end if;
    end if;
  end if;
end $$;
