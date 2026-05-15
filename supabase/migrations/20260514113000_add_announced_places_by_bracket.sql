alter table public.events
  add column if not exists announced_places_nh integer,
  add column if not exists announced_places_nd integer,
  add column if not exists announced_places_mh integer,
  add column if not exists announced_places_md integer,
  add column if not exists announced_places_sh integer,
  add column if not exists announced_places_sd integer,
  add column if not exists announced_places_rh integer,
  add column if not exists announced_places_rd integer;

update public.events
set
  announced_places_nh = greatest(1, coalesce(announced_places_nh, announced_places_n, 5)),
  announced_places_nd = greatest(1, coalesce(announced_places_nd, announced_places_n, 5)),
  announced_places_mh = greatest(1, coalesce(announced_places_mh, announced_places_m, 6)),
  announced_places_md = greatest(1, coalesce(announced_places_md, announced_places_m, 6)),
  announced_places_sh = greatest(1, coalesce(announced_places_sh, announced_places_s, 6)),
  announced_places_sd = greatest(1, coalesce(announced_places_sd, announced_places_s, 6)),
  announced_places_rh = greatest(1, coalesce(announced_places_rh, announced_places_r, 3)),
  announced_places_rd = greatest(1, coalesce(announced_places_rd, announced_places_r, 3)),
  announced_places_n = greatest(1, coalesce(announced_places_n, greatest(coalesce(announced_places_nh, 5), coalesce(announced_places_nd, 5)), 5)),
  announced_places_m = greatest(1, coalesce(announced_places_m, greatest(coalesce(announced_places_mh, 6), coalesce(announced_places_md, 6)), 6)),
  announced_places_s = greatest(1, coalesce(announced_places_s, greatest(coalesce(announced_places_sh, 6), coalesce(announced_places_sd, 6)), 6)),
  announced_places_r = greatest(1, coalesce(announced_places_r, greatest(coalesce(announced_places_rh, 3), coalesce(announced_places_rd, 3)), 3));

alter table public.events
  alter column announced_places_nh set default 5,
  alter column announced_places_nd set default 5,
  alter column announced_places_mh set default 6,
  alter column announced_places_md set default 6,
  alter column announced_places_sh set default 6,
  alter column announced_places_sd set default 6,
  alter column announced_places_rh set default 3,
  alter column announced_places_rd set default 3;

alter table public.events
  alter column announced_places_nh set not null,
  alter column announced_places_nd set not null,
  alter column announced_places_mh set not null,
  alter column announced_places_md set not null,
  alter column announced_places_sh set not null,
  alter column announced_places_sd set not null,
  alter column announced_places_rh set not null,
  alter column announced_places_rd set not null;

drop view if exists public.events_public;

create or replace view public.events_public as
select
  e.id,
  e.name,
  e.starts_at,
  e.ends_at,
  e.announced_places_n,
  e.announced_places_m,
  e.announced_places_s,
  e.announced_places_r,
  e.time_limit_n_minutes,
  e.time_limit_m_minutes,
  e.time_limit_s_minutes,
  e.time_limit_r_minutes,
  e.time_penalty_step_minutes,
  e.participating_troops,
  e.announced_places_nh,
  e.announced_places_nd,
  e.announced_places_mh,
  e.announced_places_md,
  e.announced_places_sh,
  e.announced_places_sd,
  e.announced_places_rh,
  e.announced_places_rd
from public.events e;

grant select on public.events_public to anon, authenticated;
