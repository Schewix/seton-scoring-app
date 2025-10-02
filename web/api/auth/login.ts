// web/api/auth/login.ts
import { createClient } from '@supabase/supabase-js';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
];

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing environment variable ${name} for auth handler`);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const JWT_SECRET = process.env.JWT_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 14);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function applyCors(res: any) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

function toIso(date: Date) {
  return date.toISOString();
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function createAccessToken(payload: { sub: string; stationId: string; sessionId: string; eventId: string }) {
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

function createRefreshToken(payload: { sub: string; stationId: string; sessionId: string; eventId: string }) {
  return jwt.sign({ ...payload, type: 'refresh' }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
}

function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

const ALL_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
const DEFAULT_ALLOWED_CATEGORIES: Record<string, string[]> = {
  A: ['M', 'S', 'R'],
  B: ['N', 'M', 'S', 'R'],
  C: ['N', 'M', 'S', 'R'],
  D: ['R'],
  F: ['N', 'M', 'S', 'R'],
  J: ['N', 'M', 'S', 'R'],
  K: ['N', 'M'],
  M: ['M', 'S', 'R'],
  N: ['S', 'R'],
  O: ['N', 'M', 'S', 'R'],
  P: ['N', 'M', 'S', 'R'],
  S: ['M', 'S', 'R'],
  T: ['N', 'M', 'S', 'R'],
  U: ['N', 'M', 'S', 'R'],
  V: ['S', 'R'],
  Z: ['N', 'M', 'S', 'R'],
};

function normalizeAllowedCategories(
  raw: unknown,
  stationCode: string | null | undefined,
): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
    .filter((value): value is (typeof ALL_CATEGORIES)[number] =>
      value.length > 0 && (ALL_CATEGORIES as readonly string[]).includes(value),
    );
  if (normalized.length > 0) {
    const unique = Array.from(new Set(normalized));
    unique.sort();
    return unique;
  }
  const fallbackKey = stationCode?.trim().toUpperCase() ?? '';
  const fallback = fallbackKey ? DEFAULT_ALLOWED_CATEGORIES[fallbackKey] : undefined;
  if (fallback && fallback.length > 0) {
    return [...fallback];
  }
  return [...ALL_CATEGORIES];
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

  return argon2.verify(hash, password);
}

export default async function handler(req: any, res: any) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password, devicePublicKey } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const normalizedEmail = email.trim();

  try {
    const { data: judge, error: judgeError } = await supabase
      .from('judges')
      .select('*')
      .ilike('email', normalizedEmail)
      .limit(1)
      .maybeSingle();

    if (judgeError) {
      console.error('DB error while loading judge', judgeError);
      return res.status(500).json({ error: 'DB error' });
    }

    if (!judge || typeof judge.password_hash !== 'string' || !judge.password_hash.length) {
      console.warn('No password_hash for user', normalizedEmail, judge);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let passwordOk = false;
    try {
      passwordOk = await verifyPassword(judge.password_hash, password);
    } catch (error) {
      console.error('Failed to verify password', error);
      return res.status(500).json({ error: 'Failed to verify credentials' });
    }

    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (judge.must_change_password) {
      return res.status(200).json({ id: judge.id, must_change_password: true, email: judge.email });
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('judge_assignments')
      .select('*')
      .eq('judge_id', judge.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assignmentError) {
      console.error('Failed to load assignment for judge', judge.id, assignmentError);
      return res.status(500).json({ error: 'Judge has no assignment' });
    }

    if (!assignment) {
      return res.status(403).json({ error: 'Judge has no assignment' });
    }

    const [{ data: station }, { data: event }] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name')
        .eq('id', assignment.station_id)
        .maybeSingle(),
      supabase
        .from('events')
        .select('id, name')
        .eq('id', assignment.event_id)
        .maybeSingle(),
    ]);

    if (!station || !event) {
      return res.status(500).json({ error: 'Failed to resolve assignment details' });
    }

    const allowedCategories = normalizeAllowedCategories(assignment.allowed_categories, station.code);

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
      console.error('Failed to load patrols', patrolsError);
      return res.status(500).json({ error: 'Failed to load patrols' });
    }

    const manifest = {
      judge: {
        id: judge.id,
        email: judge.email,
        displayName: judge.display_name,
      },
      station: {
        id: station.id,
        code: station.code,
        name: station.name,
      },
      event: {
        id: event.id,
        name: event.name,
      },
      allowedCategories,
      allowedTasks: assignment.allowed_tasks ?? [],
      manifestVersion: 1,
    };

    const patrols = (patrolsData ?? []) as Array<{
      id: string;
      team_name: string;
      category: string;
      sex: string;
      patrol_code: string;
    }>;

    const sessionId = randomToken(16);
    const deviceSalt = randomToken(24);
    const refreshToken = createRefreshToken({
      sub: judge.id,
      stationId: station.id,
      sessionId,
      eventId: event.id,
    });
    const accessToken = createAccessToken({
      sub: judge.id,
      stationId: station.id,
      sessionId,
      eventId: event.id,
    });

    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    const { error: sessionError } = await supabase.from('judge_sessions').insert({
      id: sessionId,
      judge_id: judge.id,
      station_id: station.id,
      device_salt: deviceSalt,
      public_key: typeof devicePublicKey === 'string' && devicePublicKey.length ? devicePublicKey : null,
      manifest_version: manifest.manifestVersion,
      refresh_token_hash: refreshTokenHash,
      refresh_token_expires_at: toIso(refreshExpiresAt),
    });

    if (sessionError) {
      console.error('Failed to initialise session', sessionError);
      return res.status(500).json({ error: 'Failed to initialise session' });
    }

    return res.status(200).json({
      access_token: accessToken,
      access_token_expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      refresh_token_expires_in: REFRESH_TOKEN_TTL_SECONDS,
      device_salt: deviceSalt,
      manifest,
      patrols,
    });
  } catch (error) {
    console.error('Unexpected error during login', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}