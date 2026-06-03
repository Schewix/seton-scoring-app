import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import {
  createAccessToken,
  createRefreshToken,
  getAuthConfig,
  hashRefreshToken,
} from '../../api-lib/authTokens.js';
import { normalizeAllowedCategories } from '../../api-lib/categories.js';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

type RefreshClaims = {
  sub?: string;
  role?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  sessionId?: string;
  session_id?: string;
  type?: string;
};

type AccessClaims = {
  sub?: string;
  role?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  sessionId?: string;
  session_id?: string;
  type?: string;
};

type SessionRow = {
  id: string;
  judge_id: string;
  station_id: string;
  device_salt: string;
  manifest_version?: number | null;
  refresh_token_hash: string;
  refresh_token_expires_at: string;
  revoked_at: string | null;
};

type AssignmentRow = {
  event_id: string;
  station_id: string;
  allowed_categories?: unknown;
  allowed_tasks?: string[] | null;
};

type StationRow = {
  id: string;
  code: string;
  name: string;
  is_closed?: boolean | null;
};

type EventRow = {
  id: string;
  name: string;
  scoring_locked: boolean | null;
  announced_places_n?: number | null;
  announced_places_m?: number | null;
  announced_places_s?: number | null;
  announced_places_r?: number | null;
  time_limit_n_minutes?: number | null;
  time_limit_m_minutes?: number | null;
  time_limit_s_minutes?: number | null;
  time_limit_r_minutes?: number | null;
  time_penalty_step_minutes?: number | null;
  target_answer_option_count?: number | null;
  participating_troops?: string[] | null;
};

type JudgeRow = {
  id: string;
  email: string | null;
  display_name: string | null;
};

type PatrolRow = {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string;
};

type StationManifest = {
  judge: { id: string; email: string; displayName: string };
  station: { id: string; code: string; name: string; isClosed: boolean };
  event: {
    id: string;
    name: string;
    scoringLocked: boolean;
    announcedPlaces: { N: number; M: number; S: number; R: number };
    timeScoring: {
      limitMinutesByCategory: { N: number; M: number; S: number; R: number };
      penaltyStepMinutes: number;
    };
    targetAnswerOptionCount: 3 | 4;
    participatingTroops: string[];
  };
  allowedCategories: string[];
  allowedTasks: string[];
  manifestVersion: number;
};

const DEFAULT_ANNOUNCED_PLACES = { N: 5, M: 6, S: 6, R: 3 } as const;
const DEFAULT_TIME_LIMIT_MINUTES = { N: 110, M: 140, S: 140, R: 140 } as const;
const DEFAULT_TIME_PENALTY_STEP_MINUTES = 20;
const DEFAULT_TARGET_ANSWER_OPTION_COUNT: 3 | 4 = 4;

function toPositiveInt(value: unknown, fallback: number, max = 1_000) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(1, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(1, parsed));
    }
  }
  return fallback;
}

function toEventManifestSettings(event: EventRow) {
  const participatingTroops = Array.isArray(event.participating_troops)
    ? event.participating_troops
        .map((item) => (typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : ''))
        .filter((item) => item.length > 0)
    : [];

  const targetAnswerOptionCount = event.target_answer_option_count === 3 ? 3 : DEFAULT_TARGET_ANSWER_OPTION_COUNT;

  return {
    announcedPlaces: {
      N: toPositiveInt(event.announced_places_n, DEFAULT_ANNOUNCED_PLACES.N, 100),
      M: toPositiveInt(event.announced_places_m, DEFAULT_ANNOUNCED_PLACES.M, 100),
      S: toPositiveInt(event.announced_places_s, DEFAULT_ANNOUNCED_PLACES.S, 100),
      R: toPositiveInt(event.announced_places_r, DEFAULT_ANNOUNCED_PLACES.R, 100),
    },
    timeScoring: {
      limitMinutesByCategory: {
        N: toPositiveInt(event.time_limit_n_minutes, DEFAULT_TIME_LIMIT_MINUTES.N, 24 * 60),
        M: toPositiveInt(event.time_limit_m_minutes, DEFAULT_TIME_LIMIT_MINUTES.M, 24 * 60),
        S: toPositiveInt(event.time_limit_s_minutes, DEFAULT_TIME_LIMIT_MINUTES.S, 24 * 60),
        R: toPositiveInt(event.time_limit_r_minutes, DEFAULT_TIME_LIMIT_MINUTES.R, 24 * 60),
      },
      penaltyStepMinutes: toPositiveInt(event.time_penalty_step_minutes, DEFAULT_TIME_PENALTY_STEP_MINUTES, 24 * 60),
    },
    targetAnswerOptionCount,
    participatingTroops,
  };
}

function applyCors(res: any) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

function respond(res: any, status: number, message: string, detail?: string) {
  if (status >= 500) {
    console.error('[api/auth/refresh]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function resolveRefreshToken(rawBody: unknown) {
  let payload: Record<string, unknown> = {};

  if (typeof rawBody === 'string') {
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (rawBody && typeof rawBody === 'object') {
    payload = rawBody as Record<string, unknown>;
  }

  const refresh =
    typeof payload.refresh_token === 'string'
      ? payload.refresh_token
      : typeof payload.refreshToken === 'string'
        ? payload.refreshToken
        : undefined;

  return refresh;
}

function toIso(date: Date) {
  return date.toISOString();
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

function resolveClaimString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function handleManifestRequest(req: any, res: any) {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing session' });
  }

  const accessToken = authHeader.slice('Bearer '.length).trim();
  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing auth configuration.';
    return respond(res, 500, message, 'auth-config');
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseAdminConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    return respond(res, 500, message, 'supabase-config');
  }

  let claims: AccessClaims;
  try {
    claims = jwt.verify(accessToken, authConfig.jwtSecret) as AccessClaims;
  } catch {
    return respond(res, 401, 'Invalid access token', 'invalid-jwt');
  }

  if (claims.type && claims.type !== 'access') {
    return respond(res, 401, 'Invalid access token', 'invalid-type');
  }

  const sessionId = resolveClaimString(claims.sessionId) ?? resolveClaimString(claims.session_id);
  const judgeId = resolveClaimString(claims.sub);
  const stationId = resolveClaimString(claims.station_id) ?? resolveClaimString(claims.stationId);
  const eventId = resolveClaimString(claims.event_id) ?? resolveClaimString(claims.eventId);

  if (!sessionId || !judgeId || !stationId || !eventId) {
    return respond(res, 401, 'Invalid access token', 'missing-claims');
  }

  const supabase = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: sessionData, error: sessionError } = await supabase
    .from('judge_sessions')
    .select('id, judge_id, station_id, device_salt, manifest_version, revoked_at')
    .eq('id', sessionId)
    .maybeSingle();

  const session = (sessionData ?? null) as SessionRow | null;
  if (sessionError || !session) {
    return respond(res, 401, 'Invalid access token', 'missing-session');
  }

  if (session.revoked_at) {
    return respond(res, 401, 'Session revoked', 'revoked');
  }

  if (session.judge_id !== judgeId || session.station_id !== stationId) {
    return respond(res, 401, 'Invalid access token', 'mismatched-session');
  }

  const [
    { data: assignmentData, error: assignmentError },
    { data: stationData, error: stationError },
    { data: eventData, error: eventError },
    { data: judgeData, error: judgeError },
  ] = await Promise.all([
    supabase
      .from('judge_assignments')
      .select('event_id, station_id, allowed_categories, allowed_tasks')
      .eq('judge_id', judgeId)
      .eq('station_id', stationId)
      .eq('event_id', eventId)
      .maybeSingle(),
    supabase
      .from('stations')
      .select('id, code, name, is_closed')
      .eq('id', stationId)
      .eq('event_id', eventId)
      .maybeSingle(),
    supabase
      .from('events')
      .select(
        'id, name, scoring_locked, announced_places_n, announced_places_m, announced_places_s, announced_places_r, time_limit_n_minutes, time_limit_m_minutes, time_limit_s_minutes, time_limit_r_minutes, time_penalty_step_minutes, target_answer_option_count, participating_troops',
      )
      .eq('id', eventId)
      .maybeSingle(),
    supabase.from('judges').select('id, email, display_name').eq('id', judgeId).maybeSingle(),
  ]);

  const assignment = (assignmentData ?? null) as AssignmentRow | null;
  if (assignmentError || !assignment) {
    if (assignmentError) {
      return respond(res, 500, 'Failed to load assignment', assignmentError.message);
    }
    return res.status(403).json({ error: 'Judge has no assignment' });
  }

  if (stationError) {
    return respond(res, 500, 'Failed to load station', stationError.message);
  }
  if (eventError) {
    return respond(res, 500, 'Failed to load event', eventError.message);
  }
  if (judgeError) {
    return respond(res, 500, 'Failed to load judge', judgeError.message);
  }

  const station = (stationData ?? null) as StationRow | null;
  const event = (eventData ?? null) as EventRow | null;
  const judge = (judgeData ?? null) as JudgeRow | null;

  if (!station || !event || !judge) {
    return respond(
      res,
      500,
      'Failed to load manifest',
      !station ? 'station-missing' : !event ? 'event-missing' : 'judge-missing',
    );
  }

  const allowedCategories = normalizeAllowedCategories(assignment.allowed_categories, station.code);
  const manifestVersion = Number.isFinite(session.manifest_version ?? 1) ? (session.manifest_version ?? 1) : 1;

  const manifest: StationManifest = {
    judge: {
      id: judge.id,
      email: judge.email ?? '',
      displayName: judge.display_name ?? judge.email ?? '',
    },
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
      isClosed: station.is_closed === true,
    },
    event: {
      id: event.id,
      name: event.name,
      scoringLocked: Boolean(event.scoring_locked),
      ...toEventManifestSettings(event),
    },
    allowedCategories,
    allowedTasks: assignment.allowed_tasks ?? [],
    manifestVersion,
  };

  let patrolQuery = supabase
    .from('patrols')
    .select('id, team_name, category, sex, patrol_code')
    .eq('event_id', eventId)
    .eq('active', true);

  if (allowedCategories.length > 0) {
    patrolQuery = patrolQuery.in('category', allowedCategories);
  }

  const { data: patrolsData, error: patrolsError } = await patrolQuery.order('patrol_code', {
    ascending: true,
  });

  if (patrolsError) {
    return respond(res, 500, 'Failed to load patrols', patrolsError.message);
  }

  const patrols = (patrolsData ?? []) as PatrolRow[];

  return res.json({ manifest, patrols, device_salt: session.device_salt });
}

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      return await handleManifestRequest(req, res);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const refreshToken = resolveRefreshToken(req.body);
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token.' });
    }

    let authConfig;
    try {
      authConfig = getAuthConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing auth configuration.';
      return respond(res, 500, message, 'auth-config');
    }

    let supabaseConfig;
    try {
      supabaseConfig = getSupabaseAdminConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
      return respond(res, 500, message, 'supabase-config');
    }

    let claims: RefreshClaims;
    try {
      claims = jwt.verify(refreshToken, authConfig.refreshSecret) as RefreshClaims;
    } catch (error) {
      return respond(res, 401, 'Invalid refresh token', 'invalid-jwt');
    }

    if (claims.type && claims.type !== 'refresh') {
      return respond(res, 401, 'Invalid refresh token', 'invalid-type');
    }

    const sessionId = resolveClaimString(claims.sessionId) ?? resolveClaimString(claims.session_id);
    const judgeId = resolveClaimString(claims.sub);
    const stationId = resolveClaimString(claims.station_id) ?? resolveClaimString(claims.stationId);
    const eventId = resolveClaimString(claims.event_id) ?? resolveClaimString(claims.eventId);

    if (!sessionId || !judgeId || !stationId || !eventId) {
      return respond(res, 401, 'Invalid refresh token', 'missing-claims');
    }

    const supabase = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: sessionData, error: sessionError } = await supabase
      .from('judge_sessions')
      .select(
        'id, judge_id, station_id, device_salt, refresh_token_hash, refresh_token_expires_at, revoked_at',
      )
      .eq('id', sessionId)
      .maybeSingle();

    const session = (sessionData ?? null) as SessionRow | null;
    if (sessionError || !session) {
      return respond(res, 401, 'Invalid refresh token', 'missing-session');
    }

    if (session.revoked_at) {
      return respond(res, 401, 'Session revoked', 'revoked');
    }

    if (session.judge_id !== judgeId || session.station_id !== stationId) {
      return respond(res, 401, 'Invalid refresh token', 'mismatched-session');
    }

    const expiresAt = new Date(session.refresh_token_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      return respond(res, 401, 'Refresh token expired', 'expired');
    }

    const tokenHash = hashRefreshToken(refreshToken);
    if (tokenHash !== session.refresh_token_hash) {
      return respond(res, 401, 'Invalid refresh token', 'hash-mismatch');
    }

    const basePayload = {
      sub: judgeId,
      sessionId,
      stationId,
      eventId,
      station_id: stationId,
      event_id: eventId,
      role: resolveClaimString(claims.role) ?? 'authenticated',
    } as const;

    const nextRefreshToken = createRefreshToken({ ...basePayload, type: 'refresh' });
    const nextAccessToken = createAccessToken({ ...basePayload, type: 'access' });
    const refreshTokenHash = hashRefreshToken(nextRefreshToken);
    const refreshExpiresAt = new Date(Date.now() + authConfig.refreshTokenTtlSeconds * 1000);

    const { error: updateError } = await supabase
      .from('judge_sessions')
      .update({
        refresh_token_hash: refreshTokenHash,
        refresh_token_expires_at: toIso(refreshExpiresAt),
      })
      .eq('id', sessionId);

    if (updateError) {
      return respond(res, 500, 'Failed to update session', updateError.message);
    }

    return res.json({
      access_token: nextAccessToken,
      access_token_expires_in: authConfig.accessTokenTtlSeconds,
      refresh_token: nextRefreshToken,
      refresh_token_expires_in: authConfig.refreshTokenTtlSeconds,
      device_salt: session.device_salt,
    });
  } catch (error) {
    return respond(res, 500, 'Internal server error', error instanceof Error ? error.message : 'unknown');
  }
}
