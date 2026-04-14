import { createClient } from '@supabase/supabase-js';
import { pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { hashPassword } from '../../api-lib/auth/password-utils.js';
import { getAuthConfig } from '../../api-lib/authTokens.js';

const pbkdf2 = promisify(pbkdf2Callback);

type AccessClaims = {
  sub?: string;
};

type ChangePasswordPayload = {
  email?: string;
  userId?: string;
  id?: string;
  newPassword?: string;
  new_password?: string;
  currentPassword?: string;
  current_password?: string;
};

function resolveChangePasswordPayload(rawBody: unknown): ChangePasswordPayload {
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

  const nested = payload.data;
  const nestedPayload =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : ({} as Record<string, unknown>);

  return {
    email: typeof payload.email === 'string' ? payload.email : (nestedPayload.email as string | undefined),
    userId: typeof payload.userId === 'string' ? payload.userId : (nestedPayload.userId as string | undefined),
    id: typeof payload.id === 'string' ? payload.id : (nestedPayload.id as string | undefined),
    newPassword:
      typeof payload.newPassword === 'string'
        ? payload.newPassword
        : (nestedPayload.newPassword as string | undefined),
    new_password:
      typeof payload.new_password === 'string'
        ? payload.new_password
        : (nestedPayload.new_password as string | undefined),
    currentPassword:
      typeof payload.currentPassword === 'string'
        ? payload.currentPassword
        : (nestedPayload.currentPassword as string | undefined),
    current_password:
      typeof payload.current_password === 'string'
        ? payload.current_password
        : (nestedPayload.current_password as string | undefined),
  };
}

function isPbkdf2Hash(hash: string) {
  return hash.startsWith('pbkdf2$sha256$');
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
    console.error('[api/auth/change-password] argon2 unavailable', error);
    throw new Error('argon2-unavailable');
  }
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

export default async function handler(req: any, res: any) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  };

  res.setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin']);
  res.setHeader('Access-Control-Allow-Methods', cors['access-control-allow-methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['access-control-allow-headers']);

  if (req.method === 'OPTIONS') {
    return res
      .status(200)
      .setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin'])
      .setHeader('Access-Control-Allow-Methods', cors['access-control-allow-methods'])
      .setHeader('Access-Control-Allow-Headers', cors['access-control-allow-headers'])
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = resolveChangePasswordPayload(req.body);
  const { email, userId, id, newPassword, new_password, currentPassword, current_password } = body;
  const resolvedEmail = typeof email === 'string' && email.trim() ? email.trim() : undefined;
  const resolvedId = typeof userId === 'string' ? userId : typeof id === 'string' ? id : undefined;
  const resolvedNewPassword =
    typeof newPassword === 'string' ? newPassword : typeof new_password === 'string' ? new_password : undefined;
  const resolvedCurrentPassword =
    typeof currentPassword === 'string'
      ? currentPassword
      : typeof current_password === 'string'
        ? current_password
        : undefined;

  const authHeader = req.headers?.authorization ?? req.headers?.Authorization;
  let tokenJudgeId: string | undefined;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    try {
      const { jwtSecret } = getAuthConfig();
      const claims = jwt.verify(token, jwtSecret) as AccessClaims;
      tokenJudgeId = typeof claims.sub === 'string' ? claims.sub : undefined;
    } catch (error) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    if (!tokenJudgeId) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
  }

  if (typeof resolvedNewPassword !== 'string' || resolvedNewPassword.length === 0) {
    return res.status(400).json({ error: 'Missing new password' });
  }

  const effectiveJudgeId = resolvedId ?? tokenJudgeId;

  if (!resolvedEmail && !effectiveJudgeId) {
    return res.status(400).json({ error: 'Missing user identifier' });
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseAdminConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    return res.status(500).json({ error: message });
  }

  const supabase = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey);

  let query = supabase.from('judges').select('id, email, password_hash').limit(1);

  if (effectiveJudgeId) {
    query = query.eq('id', effectiveJudgeId);
  } else if (resolvedEmail) {
    query = query.eq('email', resolvedEmail);
  }

  const { data: judge, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    console.error('Failed to load judge for password change', fetchError);
    return res.status(500).json({ error: 'DB error' });
  }

  if (!judge) {
    return res.status(404).json({ error: 'Judge not found' });
  }

  if (tokenJudgeId && judge.id !== tokenJudgeId) {
    return res.status(403).json({ error: 'Cannot change another user password' });
  }

  if (tokenJudgeId) {
    if (typeof resolvedCurrentPassword !== 'string' || resolvedCurrentPassword.length === 0) {
      return res.status(400).json({ error: 'Missing current password' });
    }
    if (typeof judge.password_hash !== 'string' || judge.password_hash.length === 0) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const currentPasswordOk = await verifyPassword(judge.password_hash, resolvedCurrentPassword);
    if (!currentPasswordOk) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
  }

  const password_hash = await hashPassword(resolvedNewPassword);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('judges')
    .update({ password_hash, must_change_password: false, password_rotated_at: nowIso })
    .eq('id', judge.id);

  if (updateError) {
    console.error('Failed to update password', updateError);
    return res.status(500).json({ error: 'Failed to change password' });
  }

  return res
    .status(200)
    .setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin'])
    .json({ success: true });
}
