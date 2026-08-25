alter table public.events
  add column if not exists results_confirmed_at timestamptz,
  add column if not exists results_confirmed_by uuid references public.judges(id) on delete set null;

comment on column public.events.results_confirmed_at is
  'Time when the chief judge approved the final results.';
comment on column public.events.results_confirmed_by is
  'Judge who approved the final results.';
