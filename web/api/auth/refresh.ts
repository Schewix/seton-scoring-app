import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import {
  createAccessToken,
  createRefreshToken,
  getAuthConfig,
  hashRefreshToken,
} from '../../api-lib/authTokens.js';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
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

type SessionRow = {
  id: string;
  judge_id: string;
  station_id: string;
  device_salt: string;
  refresh_token_hash: string;
  refresh_token_expires_at: string;
  revoked_at: string | null;
};

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
