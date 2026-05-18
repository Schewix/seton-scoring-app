import { createClient } from '@supabase/supabase-js';
import { pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeAllowedCategories } from '../../api-lib/categories.js';
import {
  createAccessToken,
  createRefreshToken,
  getAuthConfig,
  hashRefreshToken,
  randomToken,
} from '../../api-lib/authTokens.js';

const pbkdf2 = promisify(pbkdf2Callback);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

type JudgeRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  password_hash: string | null;
  must_change_password?: boolean | null;
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

function formatError(error: unknown): string {
  if (!error) return 'unknown-error';
  return error instanceof Error ? error.message : String(error);
}

function respond(
  res: any,
  status: number,
  message: string,
  detail?: string,
): ReturnType<any['status']> {
  if (status >= 500) {
    console.error('[api/auth/login]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function resolveLoginPayload(rawBody: unknown) {
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

  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof payload.username === 'string'
        ? payload.username
        : typeof (payload.data as Record<string, unknown>)?.email === 'string'
          ? (payload.data as Record<string, unknown>).email
          : undefined;

  const password =
    typeof payload.password === 'string'
      ? payload.password
      : typeof (payload.data as Record<string, unknown>)?.password === 'string'
        ? (payload.data as Record<string, unknown>).password
        : undefined;

  const devicePublicKey =
    typeof payload.devicePublicKey === 'string'
      ? payload.devicePublicKey
      : typeof (payload.data as Record<string, unknown>)?.devicePublicKey === 'string'
        ? (payload.data as Record<string, unknown>).devicePublicKey
        : undefined;

  const eventId =
    typeof payload.event_id === 'string'
      ? payload.event_id
      : typeof payload.eventId === 'string'
        ? payload.eventId
        : typeof (payload.data as Record<string, unknown>)?.event_id === 'string'
          ? (payload.data as Record<string, unknown>).event_id
          : typeof (payload.data as Record<string, unknown>)?.eventId === 'string'
            ? (payload.data as Record<string, unknown>).eventId
            : undefined;

  return { email, password, devicePublicKey, eventId };
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

function toIso(date: Date) {
  return date.toISOString();
}

function isPbkdf2Hash(hash: string) {
  return hash.startsWith('pbkdf2$');
}

async function verifyPbkdf2(hash: string, password: string) {
  const parts = hash.split('$');
  if (parts.length !== 5) {
    return false;
  }

  const [, algo, iterStr, b64Salt, b64Hash] = parts;
  if (algo !== 'sha256') {
    return false;
  }

  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const salt = Buffer.from(b64Salt, 'base64');
  const expected = Buffer.from(b64Hash, 'base64');
  if (!salt.length || !expected.length) {
    return false;
  }

  const derived = await pbkdf2(password, salt, iterations, expected.length, 'sha256');
  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}

async function verifyPassword(hash: string, password: string) {
  if (isPbkdf2Hash(hash)) {
    return verifyPbkdf2(hash, password);
  }

  try {
    const { default: argon2 } = await import('argon2');
    return argon2.verify(hash, password);
  } catch (error) {
    console.error('[api/auth/login] argon2 unavailable', error);
    throw new Error('argon2-unavailable');
  }
}

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { email, password, devicePublicKey, eventId } = resolveLoginPayload(req.body);

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing email or password.' });
    }

    let supabaseConfig;
    try {
      supabaseConfig = getSupabaseAdminConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
      return respond(res, 500, message, 'supabase-config');
    }

    let authConfig;
    try {
      authConfig = getAuthConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing auth configuration.';
      return respond(res, 500, message, 'auth-config');
    }

    const supabase = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
      auth: { persistSession: false },
    });

    const normalizedEmail = email.trim();

    const { data: judgeData, error: judgeError } = await supabase
      .from('judges')
      .select('id, email, display_name, password_hash, must_change_password')
      .ilike('email', normalizedEmail)
      .limit(1)
      .maybeSingle();

    const judge = (judgeData ?? null) as JudgeRow | null;
    if (judgeError || !judge) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (typeof judge.password_hash !== 'string' || judge.password_hash.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let passwordOk = false;
    try {
      passwordOk = await verifyPassword(judge.password_hash, password);
    } catch (error) {
      return respond(res, 500, 'Failed to verify credentials', formatError(error));
    }

    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (judge.must_change_password) {
      return res.json({
        must_change_password: true,
        id: judge.id,
        email: judge.email ?? normalizedEmail,
      });
    }

    const normalizedEventId = typeof eventId === 'string' ? eventId.trim() : '';
    let assignmentQuery = supabase
      .from('judge_assignments')
      .select('*')
      .eq('judge_id', judge.id);

    if (normalizedEventId) {
      assignmentQuery = assignmentQuery.eq('event_id', normalizedEventId);
    }

    const { data: assignmentData, error: assignmentError } = await assignmentQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const assignment = (assignmentData ?? null) as AssignmentRow | null;
    if (assignmentError || !assignment) {
      if (assignmentError) {
        return respond(res, 500, 'Failed to load assignment', assignmentError.message);
      }
      return res.status(403).json({
        error: normalizedEventId
          ? 'Judge has no assignment for selected event'
          : 'Judge has no assignment',
      });
    }

    const [{ data: stationData }, { data: eventData }] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name, is_closed')
        .eq('id', assignment.station_id)
        .maybeSingle(),
      supabase
        .from('events')
        .select('*')
        .eq('id', assignment.event_id)
        .maybeSingle(),
    ]);

    const station = (stationData ?? null) as StationRow | null;
    const event = (eventData ?? null) as EventRow | null;
    if (!station || !event) {
      return respond(res, 500, 'Failed to resolve assignment details', 'station-or-event-missing');
    }

    const allowedCategories = normalizeAllowedCategories(assignment.allowed_categories, station.code);

    const manifest: StationManifest = {
      judge: {
        id: judge.id,
        email: judge.email ?? normalizedEmail,
        displayName: judge.display_name ?? normalizedEmail,
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
      manifestVersion: 1,
    };

    let patrolQuery = supabase
      .from('patrols')
      .select('id, team_name, category, sex, patrol_code')
      .eq('event_id', assignment.event_id)
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

    const sessionId = randomToken(16);
    const deviceSalt = randomToken(24);

    const tokenPayload = {
      sub: judge.id,
      sessionId,
      stationId: station.id,
      eventId: event.id,
      station_id: station.id,
      event_id: event.id,
      role: 'authenticated',
    } as const;

    const refreshToken = createRefreshToken({ ...tokenPayload, type: 'refresh' });
    const accessToken = createAccessToken({ ...tokenPayload, type: 'access' });

    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + authConfig.refreshTokenTtlSeconds * 1000);

    const insertPayload = {
      id: sessionId,
      judge_id: judge.id,
      station_id: station.id,
      device_salt: deviceSalt,
      public_key: devicePublicKey ?? null,
      manifest_version: manifest.manifestVersion,
      refresh_token_hash: refreshTokenHash,
      refresh_token_expires_at: toIso(refreshExpiresAt),
    };

    const { error: sessionError } = await supabase.from('judge_sessions').insert(insertPayload);

    if (sessionError) {
      return respond(res, 500, 'Failed to initialise session', sessionError.message);
    }

    res.json({
      access_token: accessToken,
      access_token_expires_in: authConfig.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      refresh_token_expires_in: authConfig.refreshTokenTtlSeconds,
      device_salt: deviceSalt,
      manifest,
      patrols,
    });
  } catch (error) {
    return respond(res, 500, 'Internal server error', formatError(error));
  }
}
