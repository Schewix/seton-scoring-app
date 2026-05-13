alter table public.patrols
  add column if not exists patrol_members text;

update public.patrols
set patrol_members = nullif(trim(note), '')
where patrol_members is null
  and note is not null
  and trim(note) <> '';

-- Prevent duplicate start numbers across H/D in the same base category when data allows it.
do $$
begin
  if exists (
    select 1
    from public.patrols p
    where p.active is true
      and upper(trim(coalesce(p.patrol_code, ''))) ~ '^[NMSR][HD]?-\d{1,3}$'
    group by
      p.event_id,
      p.category,
      substring(upper(trim(p.patrol_code)) from '^[NMSR][HD]?-(\d{1,3})$')::int
    having count(*) > 1
  ) then
    raise notice 'Skipping shared-number unique index creation: duplicate category numbers already exist.';
  else
    create unique index if not exists patrols_event_category_number_unique_idx
      on public.patrols (
        event_id,
        category,
        (substring(upper(trim(patrol_code)) from '^[NMSR][HD]?-(\d{1,3})$')::int)
      )
      where active is true
        and upper(trim(coalesce(patrol_code, ''))) ~ '^[NMSR][HD]?-\d{1,3}$';
  end if;
end $$;

drop view if exists public.scoreboard_view;
drop view if exists public.results_ranked;
drop view if exists public.results;

create or replace view public.results as
select
  p.event_id,
  e.name as event_name,
  p.id as patrol_id,
  p.patrol_code,
  p.team_name,
  p.category,
  p.sex,
  coalesce(p.patrol_members, p.note) as patrol_members,
  p.disqualified,
  t.start_time,
  t.finish_time,
  case
    when t.start_time is not null and t.finish_time is not null
      then extract(epoch from (t.finish_time - t.start_time))::bigint
    else null
  end as total_seconds,
  (60 * coalesce(waits.wait_minutes, 0))::bigint as wait_seconds,
  case
    when t.start_time is not null and t.finish_time is not null
      then greatest(
        extract(epoch from (t.finish_time - t.start_time))::bigint
        - (60 * coalesce(waits.wait_minutes, 0))::bigint,
        0
      )
    else null
  end as pure_seconds,
  sum(s.points) as total_points,
  sum(case when st.code <> 'T' then s.points else 0 end) as points_no_T,
  sum(case when st.code = 'T' then s.points else 0 end) as time_points,
  count(*) filter (where s.points = 12) as points_12_count,
  count(*) filter (where s.points = 11) as points_11_count,
  count(*) filter (where s.points = 10) as points_10_count,
  count(*) filter (where s.points = 9) as points_9_count,
  count(*) filter (where s.points = 8) as points_8_count,
  count(*) filter (where s.points = 7) as points_7_count,
  count(*) filter (where s.points = 6) as points_6_count,
  count(*) filter (where s.points = 5) as points_5_count,
  count(*) filter (where s.points = 4) as points_4_count,
  count(*) filter (where s.points = 3) as points_3_count,
  count(*) filter (where s.points = 2) as points_2_count,
  count(*) filter (where s.points = 1) as points_1_count,
  count(*) filter (where s.points = 0) as points_0_count,
  jsonb_object_agg(st.code, s.points order by st.code) filter (where st.code is not null) as station_points_breakdown
from public.patrols p
join public.events e on e.id = p.event_id
left join public.station_scores s on s.patrol_id = p.id and s.event_id = p.event_id
left join public.stations st on st.id = s.station_id
left join public.timings t on t.event_id = p.event_id and t.patrol_id = p.id
left join (
  select
    sp.event_id,
    sp.patrol_id,
    sum(sp.wait_minutes) as wait_minutes
  from public.station_passages sp
  join public.stations st_wait on st_wait.id = sp.station_id and st_wait.event_id = sp.event_id
  where coalesce(upper(trim(st_wait.code)), '') <> 'T'
  group by sp.event_id, sp.patrol_id
) waits on waits.event_id = p.event_id and waits.patrol_id = p.id
where p.active is true
group by
  p.event_id,
  e.name,
  p.id,
  p.patrol_code,
  p.team_name,
  p.category,
  p.sex,
  coalesce(p.patrol_members, p.note),
  p.disqualified,
  t.start_time,
  t.finish_time,
  waits.wait_minutes;

create or replace view public.results_ranked as
select
  r.*,
  rank() over (
    partition by r.event_id, r.category, r.sex
    order by
      r.disqualified asc,
      r.total_points desc,
      r.points_no_T desc,
      r.pure_seconds asc,
      r.points_12_count desc,
      r.points_11_count desc,
      r.points_10_count desc,
      r.points_9_count desc,
      r.points_8_count desc,
      r.points_7_count desc,
      r.points_6_count desc,
      r.points_5_count desc,
      r.points_4_count desc,
      r.points_3_count desc,
      r.points_2_count desc,
      r.points_1_count desc,
      r.points_0_count desc
  ) as rank_in_bracket
from public.results r;

create or replace view public.scoreboard_view as
select
  r.event_id,
  e.name as event_name,
  r.patrol_id,
  r.patrol_code,
  r.team_name,
  r.category,
  r.sex,
  r.patrol_members,
  r.disqualified,
  r.start_time,
  r.finish_time,
  r.total_seconds,
  r.wait_seconds,
  r.total_points,
  r.points_no_T,
  r.pure_seconds,
  r.time_points,
  r.station_points_breakdown,
  r.rank_in_bracket
from public.results_ranked r
join public.events e on e.id = r.event_id;
