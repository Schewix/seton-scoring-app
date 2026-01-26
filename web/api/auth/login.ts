import { createClient } from '@supabase/supabase-js';
import { pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeAllowedCategories } from '../_lib/categories.js';
import {
  createAccessToken,
  createRefreshToken,
  getAuthConfig,
  hashRefreshToken,
  randomToken,
} from '../_lib/authTokens.js';

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
};

type EventRow = {
  id: string;
  name: string;
  scoring_locked: boolean | null;
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
  station: { id: string; code: string; name: string };
  event: { id: string; name: string; scoringLocked: boolean };
  allowedCategories: string[];
  allowedTasks: string[];
  manifestVersion: number;
};

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

  return { email, password, devicePublicKey };
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

    const { email, password, devicePublicKey } = resolveLoginPayload(req.body);

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

    const { data: assignmentData, error: assignmentError } = await supabase
      .from('judge_assignments')
      .select('*')
      .eq('judge_id', judge.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const assignment = (assignmentData ?? null) as AssignmentRow | null;
    if (assignmentError || !assignment) {
      if (assignmentError) {
        return respond(res, 500, 'Failed to load assignment', assignmentError.message);
      }
      return res.status(403).json({ error: 'Judge has no assignment' });
    }

    const [{ data: stationData }, { data: eventData }] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name')
        .eq('id', assignment.station_id)
        .maybeSingle(),
      supabase
        .from('events')
        .select('id, name, scoring_locked')
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
      },
      event: {
        id: event.id,
        name: event.name,
        scoringLocked: Boolean(event.scoring_locked),
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
