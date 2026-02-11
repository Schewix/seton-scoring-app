/// <reference path="../types.d.ts" />

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL environment variable.');
}

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-max-age': '86400',
};

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

type TokenClaims = {
  sub?: string;
  sessionId?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  type?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  });
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
  console.error(`[submit-station-record] ${context}`, safeError);
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padding = payload.length % 4;
  if (padding) {
    payload = payload.padEnd(payload.length + (4 - padding), '=');
  }
  try {
    const decoded = atob(payload);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing session' }, 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();

  const claims = decodeJwt(token) as TokenClaims | null;
  if (!claims || claims.type !== 'access') {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  const resolveClaimString = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value : '');
  const judgeId = resolveClaimString(claims.sub);
  const sessionId = resolveClaimString(claims.sessionId);
  const tokenEventId = resolveClaimString(claims.event_id) || resolveClaimString(claims.eventId);
  const tokenStationId = resolveClaimString(claims.station_id) || resolveClaimString(claims.stationId);

  if (!judgeId || !sessionId || !tokenEventId || !tokenStationId) {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('judge_sessions')
    .select('id, judge_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();
  if (sessionError) {
    logError('judge_sessions lookup failed', sessionError);
    return jsonResponse({ error: 'Invalid session' }, 401);
  }
  if (!session || session.revoked_at) {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  let body: SubmissionPayload | null = null;
  try {
    const rawBody = await req.json();
    body = ensurePayload(rawBody);
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body) {
    return jsonResponse({ error: 'Invalid payload' }, 400);
  }

  if (body.points < 0 || body.points > 12) {
    return jsonResponse({ error: 'Invalid points' }, 400);
  }
  if (body.wait_minutes < 0) {
    return jsonResponse({ error: 'Invalid wait minutes' }, 400);
  }

  if (tokenEventId !== body.event_id || tokenStationId !== body.station_id) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  const submittedBy = judgeId;
  const { error: submitError } = await supabaseAdmin.rpc('submit_station_record', {
    p_event_id: body.event_id,
    p_station_id: body.station_id,
    p_patrol_id: body.patrol_id,
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
    return jsonResponse({ error: 'Score insert failed' }, 500);
  }

  const { data: score, error: scoreError } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('event_id', body.event_id)
    .eq('station_id', body.station_id)
    .eq('patrol_id', body.patrol_id)
    .maybeSingle();

  if (scoreError) {
    logError('station_scores lookup failed', scoreError);
  }

  return jsonResponse({ score }, 200);
});
