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
  start_time?: string | null;
  finish_time: string | null;
  patrol_code: string;
  team_name?: string;
  patrol_members?: string | null;
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

function isValidDateString(value: string) {
  return Number.isFinite(Date.parse(value));
}

function normalizePatrolCodeVariants(raw: string) {
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/^([NMSR])([HD])?[- ]?(\d{1,3})$/);
  if (!match) {
    return [cleaned];
  }

  const parsed = Number.parseInt(match[3], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return [cleaned];
  }

  const category = match[1];
  const sex = match[2] ? match[2] : '';
  const noPad = String(parsed);
  const pad2 = noPad.padStart(2, '0');
  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    variants.push(normalized);
  };

  if (sex) {
    push(`${category}${sex}-${noPad}`);
    push(`${category}${sex}-${pad2}`);
    push(`${category}-${noPad}`);
    push(`${category}-${pad2}`);
    return variants;
  }

  push(`${category}-${noPad}`);
  push(`${category}-${pad2}`);
  push(`${category}H-${noPad}`);
  push(`${category}H-${pad2}`);
  push(`${category}D-${noPad}`);
  push(`${category}D-${pad2}`);
  return variants;
}

type PatrolLookupRow = {
  id: string;
  patrol_code: string | null;
  active?: boolean | null;
};

type ParsedPatrolCode = {
  category: string;
  sex: string;
  number: number;
};

type PatrolTargetResolution =
  | { status: 'resolved'; patrolIds: string[]; primaryPatrolId: string }
  | { status: 'not-found' };

function parsePatrolCode(raw: string): ParsedPatrolCode | null {
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/^([NMSR])([HD])?[- ]?(\d{1,3})$/);
  if (!match) {
    return null;
  }
  const number = Number.parseInt(match[3], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return {
    category: match[1],
    sex: match[2] ? match[2] : '',
    number,
  };
}

function normalizePatrolCode(raw: string) {
  const parsed = parsePatrolCode(raw);
  if (!parsed) {
    return raw.trim().toUpperCase();
  }
  return `${parsed.category}${parsed.sex ? parsed.sex : ''}-${parsed.number}`;
}

function toMergedPatrolCode(raw: string) {
  const parsed = parsePatrolCode(raw);
  if (!parsed) {
    return '';
  }
  return `${parsed.category}-${parsed.number}`;
}

function comparePatrolRows(a: PatrolLookupRow, b: PatrolLookupRow) {
  const aCode = normalizePatrolCode(a.patrol_code ?? '');
  const bCode = normalizePatrolCode(b.patrol_code ?? '');
  if (aCode !== bCode) {
    return aCode.localeCompare(bCode, 'cs');
  }
  return a.id.localeCompare(b.id, 'cs');
}

function deriveClientEventId(baseClientEventId: string, patrolId: string) {
  const source = `${baseClientEventId}:${patrolId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + index), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (code + h1), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (code + h2), 0x27d4eb2f) >>> 0;
  }
  const hex = [h1, h2, h3, h4]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  const variant = Number.parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}

function resolvePatrolTargets(rawCode: string, requestedPatrolId: string, rows: PatrolLookupRow[]): PatrolTargetResolution {
  const activeRows = rows.filter((row) => row.active !== false).sort(comparePatrolRows);
  if (activeRows.length === 0) {
    return { status: 'not-found' };
  }

  const parsedInput = parsePatrolCode(rawCode);
  if (parsedInput && !parsedInput.sex) {
    const mergedCode = `${parsedInput.category}-${parsedInput.number}`;
    const mergedMatches = activeRows.filter((row) => toMergedPatrolCode(row.patrol_code ?? '') === mergedCode);
    if (mergedMatches.length > 0) {
      const patrolIds = mergedMatches.map((row) => row.id);
      const primaryPatrolId =
        UUID_REGEX.test(requestedPatrolId) && patrolIds.includes(requestedPatrolId)
          ? requestedPatrolId
          : patrolIds[0];
      return { status: 'resolved', patrolIds, primaryPatrolId };
    }
  }

  const normalizedInput = normalizePatrolCode(rawCode);
  const exactMatches = activeRows.filter((row) => normalizePatrolCode(row.patrol_code ?? '') === normalizedInput);
  if (exactMatches.length > 0) {
    const chosen =
      UUID_REGEX.test(requestedPatrolId) && exactMatches.some((row) => row.id === requestedPatrolId)
        ? requestedPatrolId
        : exactMatches[0].id;
    return { status: 'resolved', patrolIds: [chosen], primaryPatrolId: chosen };
  }

  if (UUID_REGEX.test(requestedPatrolId)) {
    const byId = activeRows.find((row) => row.id === requestedPatrolId);
    if (byId) {
      return { status: 'resolved', patrolIds: [byId.id], primaryPatrolId: byId.id };
    }
  }

  if (activeRows.length === 1) {
    return { status: 'resolved', patrolIds: [activeRows[0].id], primaryPatrolId: activeRows[0].id };
  }

  return { status: 'not-found' };
}

function normalizePatrolMembers(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  const compact = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return compact.length > 0 ? compact : null;
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
  if (!isValidDateString(payload.client_created_at) || !isValidDateString(payload.arrived_at)) {
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
  if (payload.start_time !== undefined && payload.start_time !== null && typeof payload.start_time !== 'string') {
    return null;
  }
  if (payload.start_time !== undefined && payload.start_time !== null && !isValidDateString(payload.start_time)) {
    return null;
  }
  if (payload.finish_time !== null && typeof payload.finish_time !== 'string') {
    return null;
  }
  if (payload.finish_time !== null && !isValidDateString(payload.finish_time)) {
    return null;
  }
  if (typeof payload.note !== 'string') {
    return null;
  }
  if (payload.team_name !== undefined && typeof payload.team_name !== 'string') {
    return null;
  }
  if (
    payload.patrol_members !== undefined
    && payload.patrol_members !== null
    && typeof payload.patrol_members !== 'string'
  ) {
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
    .select('id, judge_id, station_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();
  if (sessionError) {
    logError('judge_sessions lookup failed', sessionError);
    return jsonResponse({ error: 'Invalid session' }, 401);
  }
  if (!session || session.revoked_at || session.station_id !== tokenStationId) {
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

  if (body.wait_minutes < 0) {
    return jsonResponse({ error: 'Invalid wait minutes' }, 400);
  }

  if (tokenEventId !== body.event_id) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const patrolCodeVariants = normalizePatrolCodeVariants(body.patrol_code);
  const { data: patrols, error: patrolError } = await supabaseAdmin
    .from('patrols')
    .select('id, patrol_code, active')
    .eq('event_id', body.event_id)
    .in('patrol_code', patrolCodeVariants);

  if (patrolError) {
    logError('patrols lookup failed', patrolError);
    return jsonResponse({ error: 'Patrol lookup failed' }, 500);
  }

  let resolvedTargets = resolvePatrolTargets(
    body.patrol_code,
    body.patrol_id,
    (patrols ?? []) as PatrolLookupRow[],
  );

  if (resolvedTargets.status === 'not-found' && UUID_REGEX.test(body.patrol_id)) {
    const { data: patrolById, error: patrolByIdError } = await supabaseAdmin
      .from('patrols')
      .select('id, active')
      .eq('event_id', body.event_id)
      .eq('id', body.patrol_id)
      .maybeSingle();

    if (patrolByIdError) {
      logError('patrol fallback-by-id lookup failed', patrolByIdError);
      return jsonResponse({ error: 'Patrol lookup failed' }, 500);
    }

    if (patrolById?.id && patrolById.active !== false) {
      resolvedTargets = { status: 'resolved', patrolIds: [patrolById.id], primaryPatrolId: patrolById.id };
    }
  }

  if (resolvedTargets.status === 'not-found') {
    return jsonResponse({ error: 'Unknown patrol code' }, 400);
  }

  const targetPatrolIds = resolvedTargets.patrolIds;
  const primaryPatrolId = resolvedTargets.primaryPatrolId;

  const { data: tokenStation, error: tokenStationError } = await supabaseAdmin
    .from('stations')
    .select('id, code')
    .eq('id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();
  if (tokenStationError) {
    logError('token station lookup failed', tokenStationError);
    return jsonResponse({ error: 'Token station lookup failed' }, 500);
  }
  if (!tokenStation) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  const hasCalcPrivileges = (tokenStation.code ?? '').trim().toUpperCase() === 'T';
  if (!hasCalcPrivileges && tokenStationId !== body.station_id) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const { data: tokenAssignment, error: tokenAssignmentError } = await supabaseAdmin
    .from('judge_assignments')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('event_id', tokenEventId)
    .eq('station_id', tokenStationId)
    .maybeSingle();
  if (tokenAssignmentError) {
    logError('judge_assignments token-station lookup failed', tokenAssignmentError);
    return jsonResponse({ error: 'Assignment lookup failed' }, 500);
  }
  if (!tokenAssignment) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const { data: station, error: stationError } = await supabaseAdmin
    .from('stations')
    .select('id, code')
    .eq('id', body.station_id)
    .eq('event_id', body.event_id)
    .maybeSingle();
  if (stationError) {
    logError('stations lookup failed', stationError);
    return jsonResponse({ error: 'Station lookup failed' }, 500);
  }
  if (!station) {
    return jsonResponse({ error: 'Invalid station for event' }, 400);
  }

  const stationCode = (station.code ?? '').trim().toUpperCase();
  const allowNegativePoints = stationCode === 'T';
  const minPoints = allowNegativePoints ? -12 : 0;
  if (body.points < minPoints || body.points > 12) {
    return jsonResponse({ error: 'Invalid points' }, 400);
  }

  const { data: eventState, error: eventError } = await supabaseAdmin
    .from('events')
    .select('scoring_locked, scoring_locked_at')
    .eq('id', body.event_id)
    .maybeSingle();
  if (eventError) {
    logError('events lookup failed', eventError);
    return jsonResponse({ error: 'Event lookup failed' }, 500);
  }
  if (!eventState) {
    return jsonResponse({ error: 'Invalid event' }, 400);
  }
  if (eventState.scoring_locked) {
    const lockAtMs = eventState.scoring_locked_at ? Date.parse(eventState.scoring_locked_at) : Number.NaN;
    const createdAtMs = Date.parse(body.client_created_at);
    if (!Number.isFinite(lockAtMs) || createdAtMs > lockAtMs) {
      return jsonResponse(
        {
          error: 'Event scoring is locked for new records.',
          detail: 'submission-created-after-lock',
        },
        409,
      );
    }
  }

  const submittedBy = judgeId;
  const stationRecordTargets = targetPatrolIds.map((patrolId, index) => ({
    patrolId,
    clientEventId: index === 0 ? body.client_event_id : deriveClientEventId(body.client_event_id, patrolId),
  }));
  for (const target of stationRecordTargets) {
    const { error: submitError } = await supabaseAdmin.rpc('submit_station_record', {
      p_event_id: body.event_id,
      p_station_id: body.station_id,
      p_patrol_id: target.patrolId,
      p_category: body.category,
      p_arrived_at: body.arrived_at,
      p_wait_minutes: body.wait_minutes,
      p_points: body.points,
      p_note: body.note,
      p_use_target_scoring: body.use_target_scoring,
      p_normalized_answers: body.normalized_answers,
      p_start_time: body.start_time ?? null,
      p_finish_time: body.finish_time,
      p_client_event_id: target.clientEventId,
      p_client_created_at: body.client_created_at,
      p_submitted_by: submittedBy,
    });

    if (submitError) {
      logError('submit_station_record failed', submitError);
      return jsonResponse({ error: 'Score insert failed' }, 500);
    }
  }

  if (hasCalcPrivileges) {
    const patrolUpdates: Record<string, unknown> = {};
    if (typeof body.team_name === 'string') {
      const nextTeamName = body.team_name.trim();
      if (nextTeamName.length === 0) {
        return jsonResponse({ error: 'Invalid team name' }, 400);
      }
      patrolUpdates.team_name = nextTeamName;
    }
    if (body.patrol_members !== undefined) {
      patrolUpdates.patrol_members = normalizePatrolMembers(body.patrol_members);
    }

    if (Object.keys(patrolUpdates).length > 0) {
      let { error: patrolUpdateError } = await supabaseAdmin
        .from('patrols')
        .update(patrolUpdates)
        .eq('event_id', body.event_id)
        .in('id', targetPatrolIds);

      if (
        patrolUpdateError
        && Object.prototype.hasOwnProperty.call(patrolUpdates, 'patrol_members')
        && /patrol_members/i.test(patrolUpdateError.message ?? '')
      ) {
        const fallbackUpdates: Record<string, unknown> = { ...patrolUpdates };
        fallbackUpdates.note = fallbackUpdates.patrol_members ?? null;
        delete fallbackUpdates.patrol_members;
        const retry = await supabaseAdmin
          .from('patrols')
          .update(fallbackUpdates)
          .eq('event_id', body.event_id)
          .in('id', targetPatrolIds);
        patrolUpdateError = retry.error;
      }

      if (patrolUpdateError) {
        logError('patrol update failed', patrolUpdateError);
        return jsonResponse({ error: 'Patrol update failed' }, 500);
      }
    }
  }

  const { data: score, error: scoreError } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('event_id', body.event_id)
    .eq('station_id', body.station_id)
    .eq('patrol_id', primaryPatrolId)
    .maybeSingle();

  if (scoreError) {
    logError('station_scores lookup failed', scoreError);
  }

  return jsonResponse(
    {
      score,
      mirrored_patrol_ids: targetPatrolIds.length > 1 ? targetPatrolIds : undefined,
    },
    200,
  );
});
