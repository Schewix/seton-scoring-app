import { supabaseAdmin } from './supabase';
import { seedData } from './seedData';

async function resetBaseData() {
  await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('station_scores').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('station_passages').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('timings').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('judge_assignments').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('judge_sessions').delete().eq('station_id', seedData.stationId);
  await supabaseAdmin.from('stations').delete().eq('id', seedData.stationId);
  await supabaseAdmin.from('patrols').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('events').delete().eq('id', seedData.eventId);
  await supabaseAdmin.from('judges').delete().eq('id', seedData.judgeId);
}

export default async function globalSetup() {
  await resetBaseData();

  const refreshExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await supabaseAdmin.from('events').insert({
    id: seedData.eventId,
    name: 'E2E Event',
    scoring_locked: false,
  });
  await supabaseAdmin.from('stations').insert({
    id: seedData.stationId,
    event_id: seedData.eventId,
    code: seedData.stationCode,
    name: 'E2E Stanoviste',
  });
  await supabaseAdmin.from('patrols').insert(
    seedData.patrols.map((patrol) => ({
      ...patrol,
      event_id: seedData.eventId,
      active: true,
    })),
  );
  await supabaseAdmin.from('judges').insert({
    id: seedData.judgeId,
    email: 'judge-e2e@example.com',
    password_hash: 'hash',
    display_name: 'E2E Judge',
  });
  await supabaseAdmin.from('judge_assignments').insert({
    judge_id: seedData.judgeId,
    station_id: seedData.stationId,
    event_id: seedData.eventId,
    allowed_categories: ['M'],
    allowed_tasks: [],
  });
  await supabaseAdmin.from('judge_sessions').insert({
    id: seedData.sessionId,
    judge_id: seedData.judgeId,
    station_id: seedData.stationId,
    device_salt: 'e2e-salt',
    public_key: 'e2e-public',
    manifest_version: 1,
    refresh_token_hash: 'e2e-refresh-hash',
    refresh_token_expires_at: refreshExpiresAt,
  });
}
