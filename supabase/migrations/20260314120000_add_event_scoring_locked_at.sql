alter table if exists public.events
  add column if not exists scoring_locked_at timestamptz;

update public.events
set scoring_locked_at = least(
  coalesce(scoring_locked_at, now()),
  (
    date_trunc('day', coalesce(scoring_locked_at, now()) at time zone 'Europe/Prague')
    + interval '16 hours'
  ) at time zone 'Europe/Prague'
)
where scoring_locked = true;
