-- Add client-side idempotency metadata and supporting indexes.

alter table events
  add column if not exists scoring_locked boolean not null default false;

alter table station_scores
  add column if not exists client_event_id uuid,
  add column if not exists client_created_at timestamptz,
  add column if not exists submitted_by uuid;

alter table station_passages
  add column if not exists client_event_id uuid,
  add column if not exists client_created_at timestamptz,
  add column if not exists submitted_by uuid;

alter table station_quiz_responses
  add column if not exists client_event_id uuid,
  add column if not exists client_created_at timestamptz,
  add column if not exists submitted_by uuid;

alter table timings
  add column if not exists client_event_id uuid,
  add column if not exists client_created_at timestamptz,
  add column if not exists submitted_by uuid;

create unique index if not exists station_scores_client_event_id_idx
  on station_scores(client_event_id);

create unique index if not exists station_passages_client_event_id_idx
  on station_passages(client_event_id);

create unique index if not exists station_quiz_responses_client_event_id_idx
  on station_quiz_responses(client_event_id);

create unique index if not exists timings_client_event_id_idx
  on timings(client_event_id);
