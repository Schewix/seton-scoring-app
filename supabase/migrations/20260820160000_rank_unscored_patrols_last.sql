create or replace view public.results_ranked as
select
  r.*,
  rank() over (
    partition by r.event_id, r.category, r.sex
    order by
      r.disqualified asc,
      r.total_points desc nulls last,
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
