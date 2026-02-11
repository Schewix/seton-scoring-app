-- Add disqualification flag to patrols and adjust result ordering.

alter table patrols
  add column if not exists disqualified boolean not null default false;

drop view if exists scoreboard_view;
drop view if exists results_ranked;
drop view if exists results;

create or replace view results as
select
  p.event_id,
  e.name as event_name,
  p.id as patrol_id,
  p.patrol_code,
  p.team_name,
  p.category,
  p.sex,
  p.note as patrol_members,
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
  jsonb_object_agg(st.code, s.points order by st.code) filter (where st.code is not null) as station_points_breakdown
from patrols p
join events e on e.id = p.event_id
left join station_scores s on s.patrol_id = p.id and s.event_id = p.event_id
left join stations st on st.id = s.station_id
left join timings t on t.event_id = p.event_id and t.patrol_id = p.id
left join (
  select
    sp.event_id,
    sp.patrol_id,
    sum(sp.wait_minutes) as wait_minutes
  from station_passages sp
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
  p.note,
  p.disqualified,
  t.start_time,
  t.finish_time,
  waits.wait_minutes;

create or replace view results_ranked as
select
  r.*,
  rank() over (
    partition by r.event_id, r.category, r.sex
    order by r.disqualified asc, r.total_points desc, r.points_no_T desc, r.pure_seconds asc
  ) as rank_in_bracket
from results r;

create or replace view scoreboard_view as
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
from results_ranked r
join events e on e.id = r.event_id;
