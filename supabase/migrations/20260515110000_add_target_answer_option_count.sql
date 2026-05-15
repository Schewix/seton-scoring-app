alter table public.events
  add column if not exists target_answer_option_count integer;

update public.events
set target_answer_option_count = case
  when target_answer_option_count in (3, 4) then target_answer_option_count
  else 4
end;

alter table public.events
  alter column target_answer_option_count set default 4,
  alter column target_answer_option_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_target_answer_option_count_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_target_answer_option_count_check
      check (target_answer_option_count in (3, 4));
  end if;
end;
$$;
