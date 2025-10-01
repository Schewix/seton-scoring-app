-- Results view (sum points, sum without 'T', pure time)
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
  sum(s.points) as total_points,
  sum(case when st.code <> 'T' then s.points else 0 end) as points_no_T,
  (
    extract(epoch from (t.finish_time - t.start_time))
    - coalesce(60 * (select sum(wait_minutes) from station_passages sp
                     where sp.event_id=p.event_id and sp.patrol_id=p.id),0)
  )::bigint as pure_seconds
from patrols p
join events e on e.id = p.event_id
left join station_scores s on s.patrol_id=p.id and s.event_id=p.event_id
left join stations st on st.id = s.station_id
left join timings t on t.event_id=p.event_id and t.patrol_id=p.id
where p.active is true
group by
  p.event_id,
  p.id,
  p.patrol_code,
  p.team_name,
  p.category,
  p.sex,
  p.note,
  t.start_time,
  t.finish_time;

-- Ranking per (category, sex)
create or replace view results_ranked as
select
  r.*,
  rank() over (
    partition by r.event_id, r.category, r.sex
    order by r.total_points desc, r.points_no_T desc, r.pure_seconds asc
  ) as rank_in_bracket
from results r;
