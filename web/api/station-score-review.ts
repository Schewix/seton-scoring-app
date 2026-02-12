import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../api-lib/authTokens.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCORE_REVIEW_TASK_KEYS = new Set([
  'score-review',
  'score_review',
  'review-station-scores',
  'calc',
  'calc-score-review',
  'manage-results',
  'manage-wait-times',
]);

type ReviewPayload = {
  event_id: string;
  patrol_id: string;
  patrol_code?: string;
};

type TokenClaims = {
  sub?: string;
  sessionId?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  type?: string;
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

function respond(res: any, status: number, message: string, detail?: string) {
  if (status >= 500) {
    console.error('[api/station-score-review]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensurePayload(body: unknown): ReviewPayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const payload = body as ReviewPayload;
  if (!isString(payload.event_id) || !isString(payload.patrol_id)) {
    return null;
  }
  if (payload.patrol_code !== undefined && typeof payload.patrol_code !== 'string') {
    return null;
  }
  return payload;
}

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
  } catch {
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
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const body = ensurePayload(rawBody);
  if (!body) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (tokenEventId !== body.event_id) {
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

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('judge_sessions')
    .select('id, judge_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();

  if (sessionError) {
    return respond(res, 500, 'Session lookup failed', sessionError.message);
  }

  if (!session || session.revoked_at) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('judge_assignments')
    .select('id, allowed_tasks')
    .eq('judge_id', judgeId)
    .eq('station_id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (assignmentError) {
    return respond(res, 500, 'Assignment lookup failed', assignmentError.message);
  }

  if (!assignment) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: station, error: stationError } = await supabaseAdmin
    .from('stations')
    .select('code')
    .eq('id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (stationError) {
    return respond(res, 500, 'Station lookup failed', stationError.message);
  }

  const stationCode = (station?.code ?? '').trim().toUpperCase();
  const allowedTasks = Array.isArray(assignment.allowed_tasks) ? assignment.allowed_tasks : [];
  const canReview =
    stationCode === 'T' || allowedTasks.some((task) => SCORE_REVIEW_TASK_KEYS.has(String(task)));

  if (!canReview) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let resolvedPatrolId = body.patrol_id;
  if (!UUID_REGEX.test(resolvedPatrolId)) {
    if (!isString(body.patrol_code)) {
      return res.status(400).json({ error: 'Invalid patrol code' });
    }
    const patrolCodeVariants = normalizePatrolCodeVariants(body.patrol_code);
    const { data: patrol, error: patrolError } = await supabaseAdmin
      .from('patrols')
      .select('id')
      .eq('event_id', body.event_id)
      .in('patrol_code', patrolCodeVariants)
      .maybeSingle();

    if (patrolError) {
      return respond(res, 500, 'Patrol lookup failed', patrolError.message);
    }

    if (!patrol?.id) {
      return respond(res, 400, 'Unknown patrol code', body.patrol_code);
    }

    resolvedPatrolId = patrol.id;
  }

  const [stationsRes, scoresRes, waitsRes] = await Promise.all([
    supabaseAdmin.from('stations').select('id, code, name').eq('event_id', body.event_id),
    supabaseAdmin
      .from('station_scores')
      .select('station_id, points, judge, note')
      .eq('event_id', body.event_id)
      .eq('patrol_id', resolvedPatrolId),
    supabaseAdmin
      .from('station_passages')
      .select('station_id, wait_minutes')
      .eq('event_id', body.event_id)
      .eq('patrol_id', resolvedPatrolId),
  ]);

  if (stationsRes.error || scoresRes.error || waitsRes.error) {
    return respond(res, 500, 'Review lookup failed', [
      stationsRes.error?.message,
      scoresRes.error?.message,
      waitsRes.error?.message,
    ]
      .filter(Boolean)
      .join(' | '));
  }

  return res.status(200).json({
    stations: stationsRes.data ?? [],
    scores: scoresRes.data ?? [],
    waits: waitsRes.data ?? [],
  });
}
