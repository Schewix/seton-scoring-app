import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../api-lib/authTokens.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SubmissionPayload = {
  client_event_id: string;
  client_created_at: string;
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  note: string;
  use_target_scoring: boolean;
  normalized_answers: string | null;
  finish_time: string | null;
  patrol_code: string;
  team_name?: string;
  sex?: string;
};

function normalizePatrolCodeVariants(raw: string) {
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (!match) {
    return [cleaned];
  }

  const parsed = Number.parseInt(match[3], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return [cleaned];
  }

  const noPad = `${match[1]}${match[2]}-${parsed}`;
  const pad = `${match[1]}${match[2]}-${String(parsed).padStart(2, '0')}`;
  return noPad === pad ? [noPad] : [noPad, pad];
}

function logError(context: string, error: unknown) {
  const safeError =
    error && typeof error === 'object'
      ? {
          message: (error as { message?: string }).message,
          code: (error as { code?: string }).code,
          details: (error as { details?: string }).details,
        }
      : { message: String(error) };
  console.error(`[api/submit-station-record] ${context}`, safeError);
}

function formatErrorDetail(error: unknown): string {
  if (!error) return 'unknown-error';
  if (error instanceof Error) return error.message;
  return String(error);
}

function respond(
  res: any,
  status: number,
  message: string,
  detail?: string,
): ReturnType<any['status']> {
  if (status >= 500) {
    console.error('[api/submit-station-record]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensurePayload(body: unknown): SubmissionPayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const payload = body as SubmissionPayload;
  if (!isString(payload.client_event_id) || !UUID_REGEX.test(payload.client_event_id)) {
    return null;
  }
  if (!isString(payload.event_id) || !isString(payload.station_id) || !isString(payload.patrol_id)) {
    return null;
  }
  if (!isString(payload.client_created_at) || !isString(payload.arrived_at)) {
    return null;
  }
  if (!isString(payload.category) || !isString(payload.patrol_code)) {
    return null;
  }
  if (typeof payload.points !== 'number' || !Number.isInteger(payload.points)) {
    return null;
  }
  if (typeof payload.wait_minutes !== 'number' || !Number.isInteger(payload.wait_minutes)) {
    return null;
  }
  if (typeof payload.use_target_scoring !== 'boolean') {
    return null;
  }
  if (payload.normalized_answers !== null && typeof payload.normalized_answers !== 'string') {
    return null;
  }
  if (payload.finish_time !== null && typeof payload.finish_time !== 'string') {
    return null;
  }
  if (typeof payload.note !== 'string') {
    return null;
  }
  return payload;
}

function getSupabaseAdminConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }

  return { supabaseUrl, serviceRoleKey };
}

type TokenClaims = {
  sub?: string;
  sessionId?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  type?: string;
};

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing session' });
  }

  const token = authHeader.slice('Bearer '.length).trim();

  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing auth configuration.';
    return respond(res, 500, message, 'auth-config');
  }

  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, authConfig.jwtSecret) as TokenClaims;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid JWT' });
  }

  if (claims.type !== 'access') {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const resolveClaimString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : '');
  const sessionId = resolveClaimString(claims.sessionId);
  const judgeId = resolveClaimString(claims.sub);
  const tokenEventId = resolveClaimString(claims.event_id) || resolveClaimString(claims.eventId);
  const tokenStationId = resolveClaimString(claims.station_id) || resolveClaimString(claims.stationId);

  if (!sessionId || !judgeId || !tokenEventId || !tokenStationId) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  let rawBody: unknown = req.body;
  if (typeof rawBody === 'string') {
    try {
      rawBody = JSON.parse(rawBody);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const body = ensurePayload(rawBody);
  if (!body) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (body.points < 0 || body.points > 12) {
    return res.status(400).json({ error: 'Invalid points' });
  }
  if (body.wait_minutes < 0) {
    return res.status(400).json({ error: 'Invalid wait minutes' });
  }

  if (tokenEventId !== body.event_id || tokenStationId !== body.station_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseAdminConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    return respond(res, 500, message, 'supabase-config');
  }

  const supabaseAdmin = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false },
  });

  let resolvedPatrolId = body.patrol_id;
  if (!UUID_REGEX.test(resolvedPatrolId)) {
    const patrolCodeVariants = normalizePatrolCodeVariants(body.patrol_code);
    const { data: patrol, error: patrolError } = await supabaseAdmin
      .from('patrols')
      .select('id')
      .eq('event_id', body.event_id)
      .in('patrol_code', patrolCodeVariants)
      .maybeSingle();

    if (patrolError) {
      logError('patrols lookup failed', patrolError);
      return respond(res, 500, 'Patrol lookup failed', patrolError.message);
    }

    if (!patrol?.id) {
      return respond(res, 400, 'Unknown patrol code', body.patrol_code);
    }

    resolvedPatrolId = patrol.id;
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('judge_sessions')
    .select('id, judge_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();

  if (sessionError) {
    logError('judge_sessions lookup failed', sessionError);
    return respond(res, 500, 'Session lookup failed', sessionError.message);
  }

  if (!session || session.revoked_at) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('judge_assignments')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('event_id', body.event_id)
    .eq('station_id', body.station_id)
    .maybeSingle();

  if (assignmentError) {
    logError('judge_assignments lookup failed', assignmentError);
    return respond(res, 500, 'Assignment lookup failed', assignmentError.message);
  }

  if (!assignment) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const submittedBy = judgeId;
  const { error: submitError } = await supabaseAdmin.rpc('submit_station_record', {
    p_event_id: body.event_id,
    p_station_id: body.station_id,
    p_patrol_id: resolvedPatrolId,
    p_category: body.category,
    p_arrived_at: body.arrived_at,
    p_wait_minutes: body.wait_minutes,
    p_points: body.points,
    p_note: body.note,
    p_use_target_scoring: body.use_target_scoring,
    p_normalized_answers: body.normalized_answers,
    p_finish_time: body.finish_time,
    p_client_event_id: body.client_event_id,
    p_client_created_at: body.client_created_at,
    p_submitted_by: submittedBy,
  });

  if (submitError) {
    logError('submit_station_record failed', submitError);
    return respond(res, 500, 'Score insert failed', submitError.message);
  }

  const { data: score, error: scoreError } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('event_id', body.event_id)
    .eq('station_id', body.station_id)
    .eq('patrol_id', resolvedPatrolId)
    .maybeSingle();

  if (scoreError) {
    logError('station_scores lookup failed', scoreError);
  }

  return res.status(200).json({ score });
}
