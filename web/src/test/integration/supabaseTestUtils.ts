import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { ensureTestSupabaseEnv } from '../testEnv';

const { supabaseUrl, serviceRoleKey, jwtSecret } = ensureTestSupabaseEnv();

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export type SeedContext = {
  eventId: string;
  stationId: string;
  patrolId: string;
  patrolCode: string;
  judgeId: string;
  sessionId: string;
  accessToken: string;
};

export function createAccessToken(payload: {
  sub: string;
  sessionId: string;
  eventId: string;
  stationId: string;
  role?: string;
  type?: string;
}) {
  const { role, type = 'access', ...rest } = payload;
  return jwt.sign({ ...rest, role, type }, jwtSecret, { expiresIn: 60 * 60 });
}

export function createUserToken(payload: {
  sub: string;
  eventId: string;
  stationId: string;
  role?: string;
}) {
  const { role = 'authenticated', ...rest } = payload;
  return jwt.sign({ ...rest, role }, jwtSecret, { expiresIn: 60 * 60 });
}

export async function resetTestData(context: Partial<SeedContext>) {
  const { eventId, stationId, judgeId } = context;
  if (eventId) {
    await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', eventId);
    await supabaseAdmin.from('station_scores').delete().eq('event_id', eventId);
    await supabaseAdmin.from('station_passages').delete().eq('event_id', eventId);
    await supabaseAdmin.from('timings').delete().eq('event_id', eventId);
    await supabaseAdmin.from('judge_assignments').delete().eq('event_id', eventId);
    await supabaseAdmin.from('stations').delete().eq('event_id', eventId);
    await supabaseAdmin.from('patrols').delete().eq('event_id', eventId);
    await supabaseAdmin.from('events').delete().eq('id', eventId);
  }
  if (stationId) {
    await supabaseAdmin.from('judge_sessions').delete().eq('station_id', stationId);
  }
  if (judgeId) {
    await supabaseAdmin.from('judges').delete().eq('id', judgeId);
  }
}

export async function seedBase(): Promise<SeedContext> {
  const eventId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const patrolId = crypto.randomUUID();
  const judgeId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const patrolCode = 'MH-1';
  const judgeEmail = `judge-${judgeId}@example.com`;

  const nowIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const assertNoError = (error: unknown, context: string) => {
    if (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message?: string }).message
          : String(error);
      throw new Error(`Seed ${context} failed: ${message}`);
    }
  };

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .insert({ id: eventId, name: 'Test Event', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'K', name: 'Stanoviště K' });
  assertNoError(stationError, 'stations');

  const { error: patrolError } = await supabaseAdmin.from('patrols').insert({
    id: patrolId,
    event_id: eventId,
    team_name: 'Test patrol',
    category: 'M',
    sex: 'H',
    patrol_code: patrolCode,
    active: true,
  });
  assertNoError(patrolError, 'patrols');

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: judgeEmail,
    password_hash: 'hash',
    display_name: 'Judge Test',
  });
  assertNoError(judgeError, 'judges');

  const { error: assignmentError } = await supabaseAdmin.from('judge_assignments').insert({
    judge_id: judgeId,
    station_id: stationId,
    event_id: eventId,
    allowed_categories: ['M'],
    allowed_tasks: [],
  });
  assertNoError(assignmentError, 'judge_assignments');

  const { error: sessionError } = await supabaseAdmin.from('judge_sessions').insert({
    id: sessionId,
    judge_id: judgeId,
    station_id: stationId,
    device_salt: 'salt',
    public_key: 'pub',
    manifest_version: 1,
    refresh_token_hash: 'hash',
    refresh_token_expires_at: nowIso,
  });
  assertNoError(sessionError, 'judge_sessions');

  const accessToken = createAccessToken({ sub: judgeId, sessionId, eventId, stationId });

  return { eventId, stationId, patrolId, patrolCode, judgeId, sessionId, accessToken };
}
