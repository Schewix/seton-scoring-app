create or replace function public.submit_station_record(
  p_event_id uuid,
  p_station_id uuid,
  p_patrol_id uuid,
  p_category category,
  p_arrived_at timestamptz,
  p_wait_minutes int,
  p_points int,
  p_note text,
  p_use_target_scoring boolean,
  p_normalized_answers text,
  p_finish_time timestamptz,
  p_client_event_id uuid,
  p_client_created_at timestamptz,
  p_submitted_by uuid
)
returns station_scores
language plpgsql
security definer
set search_path = public
as $$
declare
  result station_scores;
begin
  insert into station_passages (
    event_id,
    station_id,
    patrol_id,
    arrived_at,
    wait_minutes,
    client_event_id,
    client_created_at,
    submitted_by
  ) values (
    p_event_id,
    p_station_id,
    p_patrol_id,
    p_arrived_at,
    p_wait_minutes,
    p_client_event_id,
    p_client_created_at,
    p_submitted_by
  )
  on conflict (event_id, patrol_id, station_id)
  do update set
    arrived_at = excluded.arrived_at,
    wait_minutes = excluded.wait_minutes,
    client_event_id = excluded.client_event_id,
    client_created_at = excluded.client_created_at,
    submitted_by = excluded.submitted_by
  where station_passages.client_created_at is null
     or station_passages.client_created_at <= excluded.client_created_at;

  insert into station_scores (
    event_id,
    station_id,
    patrol_id,
    points,
    note,
    client_event_id,
    client_created_at,
    submitted_by
  ) values (
    p_event_id,
    p_station_id,
    p_patrol_id,
    p_points,
    nullif(p_note, ''),
    p_client_event_id,
    p_client_created_at,
    p_submitted_by
  )
  on conflict (event_id, patrol_id, station_id)
  do update set
    points = excluded.points,
    note = excluded.note,
    client_event_id = excluded.client_event_id,
    client_created_at = excluded.client_created_at,
    submitted_by = excluded.submitted_by
  where station_scores.client_created_at is null
     or station_scores.client_created_at <= excluded.client_created_at;

  if p_finish_time is not null then
    insert into timings (
      event_id,
      patrol_id,
      finish_time,
      client_event_id,
      client_created_at,
      submitted_by
    ) values (
      p_event_id,
      p_patrol_id,
      p_finish_time,
      p_client_event_id,
      p_client_created_at,
      p_submitted_by
    )
    on conflict (event_id, patrol_id)
    do update set
      finish_time = excluded.finish_time,
      client_event_id = excluded.client_event_id,
      client_created_at = excluded.client_created_at,
      submitted_by = excluded.submitted_by
    where timings.client_created_at is null
       or timings.client_created_at <= excluded.client_created_at;
  end if;

  if p_use_target_scoring and p_normalized_answers is not null then
    insert into station_quiz_responses (
      event_id,
      station_id,
      patrol_id,
      category,
      answers,
      correct_count,
      client_event_id,
      client_created_at,
      submitted_by
    ) values (
      p_event_id,
      p_station_id,
      p_patrol_id,
      p_category,
      p_normalized_answers,
      p_points,
      p_client_event_id,
      p_client_created_at,
      p_submitted_by
    )
    on conflict (event_id, station_id, patrol_id)
    do update set
      category = excluded.category,
      answers = excluded.answers,
      correct_count = excluded.correct_count,
      client_event_id = excluded.client_event_id,
      client_created_at = excluded.client_created_at,
      submitted_by = excluded.submitted_by
    where station_quiz_responses.client_created_at is null
       or station_quiz_responses.client_created_at <= excluded.client_created_at;
  else
    delete from station_quiz_responses
      where event_id = p_event_id
        and station_id = p_station_id
        and patrol_id = p_patrol_id
        and (client_created_at is null or client_created_at <= p_client_created_at);
  end if;

  select * into result
    from station_scores
    where event_id = p_event_id
      and station_id = p_station_id
      and patrol_id = p_patrol_id;

  return result;
end;
$$;
