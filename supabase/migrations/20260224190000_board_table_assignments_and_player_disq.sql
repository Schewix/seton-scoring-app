alter table public.board_player
  add column if not exists disqualified boolean not null default false;

alter table public.board_judge_assignment
  add column if not exists table_number int;

alter table public.board_match
  add column if not exists table_number int;

do $$ begin
  alter table public.board_judge_assignment
    add constraint board_assignment_table_number_chk
      check (table_number is null or table_number >= 1);
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.board_match
    add constraint board_match_table_number_chk
      check (table_number is null or table_number >= 1);
exception
  when duplicate_object then null;
end $$;

create unique index if not exists board_assignment_table_unique_idx
  on public.board_judge_assignment(event_id, game_id, category_id, table_number)
  where table_number is not null;

create unique index if not exists board_match_unique_round_table_idx
  on public.board_match(event_id, block_id, round_number, table_number)
  where round_number is not null and table_number is not null and status = 'submitted';

create index if not exists board_match_created_by_event_idx
  on public.board_match(event_id, created_by, block_id, round_number, table_number);

drop policy if exists board_match_player_update_assigned on public.board_match_player;
create policy board_match_player_update_assigned on public.board_match_player
  for update using (
    exists (
      select 1
      from public.board_match m
      where m.id = match_id
        and public.board_can_submit_match(m.event_id, m.block_id, m.category_id, m.created_by)
    )
  )
  with check (
    exists (
      select 1
      from public.board_match m
      where m.id = match_id
        and public.board_can_submit_match(m.event_id, m.block_id, m.category_id, m.created_by)
    )
  );
