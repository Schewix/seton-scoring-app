do $$ begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stations'
      and column_name = 'is_split'
  ) then
    alter table public.stations
      add column is_split boolean not null default false;
  end if;
exception when duplicate_column then null; end $$;

do $$ begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stations'
      and column_name = 'split_categories'
  ) then
    alter table public.stations
      add column split_categories category[] not null default array[]::category[];
  end if;
exception when duplicate_column then null; end $$;
