import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from './_lib/authTokens.js';

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
  station_id?: string;
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
    return res.status(500).json({ error: message });
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

  const sessionId = typeof claims.sessionId === 'string' ? claims.sessionId : '';
  const judgeId = typeof claims.sub === 'string' ? claims.sub : '';
  const tokenEventId = typeof claims.event_id === 'string' ? claims.event_id : '';
  const tokenStationId = typeof claims.station_id === 'string' ? claims.station_id : '';

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
    return res.status(500).json({ error: message });
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
    logError('judge_sessions lookup failed', sessionError);
    return res.status(500).json({ error: 'Session lookup failed' });
  }

  if (!session || session.revoked_at) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { data: existingScore, error: existingError } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('client_event_id', body.client_event_id)
    .maybeSingle();

  if (existingError) {
    logError('station_scores lookup failed', existingError);
    return res.status(500).json({ error: 'Lookup failed' });
  }

  if (existingScore) {
    return res.status(200).json({ score: existingScore });
  }

  const submittedBy = judgeId;
  const { data: score, error: scoreError } = await supabaseAdmin
    .from('station_scores')
    .upsert(
      {
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
        points: body.points,
        note: body.note || null,
        client_event_id: body.client_event_id,
        client_created_at: body.client_created_at,
        submitted_by: submittedBy,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    )
    .select('*')
    .maybeSingle();

  if (scoreError) {
    logError('station_scores upsert failed', scoreError);
    return res.status(500).json({ error: 'Score insert failed' });
  }

  const { error: passageError } = await supabaseAdmin
    .from('station_passages')
    .upsert(
      {
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
        arrived_at: body.arrived_at,
        wait_minutes: body.wait_minutes,
        client_event_id: body.client_event_id,
        client_created_at: body.client_created_at,
        submitted_by: submittedBy,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    );

  if (passageError) {
    logError('station_passages upsert failed', passageError);
    return res.status(500).json({ error: 'Passage upsert failed' });
  }

  if (body.finish_time) {
    const { error: timingError } = await supabaseAdmin
      .from('timings')
      .upsert(
        {
          event_id: body.event_id,
          patrol_id: body.patrol_id,
          finish_time: body.finish_time,
          client_event_id: body.client_event_id,
          client_created_at: body.client_created_at,
          submitted_by: submittedBy,
        },
        { onConflict: 'event_id,patrol_id' },
      );

    if (timingError) {
      logError('timings upsert failed', timingError);
      return res.status(500).json({ error: 'Timing upsert failed' });
    }
  }

  if (body.use_target_scoring && body.normalized_answers) {
    const { error: quizError } = await supabaseAdmin
      .from('station_quiz_responses')
      .upsert(
        {
          event_id: body.event_id,
          station_id: body.station_id,
          patrol_id: body.patrol_id,
          category: body.category,
          answers: body.normalized_answers,
          correct_count: body.points,
          client_event_id: body.client_event_id,
          client_created_at: body.client_created_at,
          submitted_by: submittedBy,
        },
        { onConflict: 'event_id,station_id,patrol_id' },
      );

    if (quizError) {
      logError('station_quiz_responses upsert failed', quizError);
      return res.status(500).json({ error: 'Quiz upsert failed' });
    }
  } else if (!body.use_target_scoring) {
    const { error: deleteError } = await supabaseAdmin
      .from('station_quiz_responses')
      .delete()
      .match({
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
      });

    if (deleteError) {
      logError('station_quiz_responses delete failed', deleteError);
      return res.status(500).json({ error: 'Quiz delete failed' });
    }
  }

  return res.status(200).json({ score });
}
