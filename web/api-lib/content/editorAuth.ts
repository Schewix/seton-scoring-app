import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';

const COOKIE_NAME = 'zl_editor_session';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function getCookieDomain() {
  if (!isProd()) {
    return undefined;
  }
  return process.env.CONTENT_COOKIE_DOMAIN ?? '.zelenaliga.cz';
}

function getSecret() {
  const secret = process.env.CONTENT_JWT_SECRET ?? process.env.JWT_SECRET ?? '';
  if (secret.length < 16) {
    throw new Error('Missing CONTENT_JWT_SECRET environment variable.');
  }
  return secret;
}

export function verifyEditorSession(req: any): { ok: boolean } {
  const rawCookie = typeof req?.headers?.cookie === 'string' ? req.headers.cookie : '';
  const cookies = parse(rawCookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) {
    return { ok: false };
  }
  try {
    jwt.verify(token, getSecret());
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function requireEditor(req: any, res: any): boolean {
  const { ok } = verifyEditorSession(req);
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function setEditorSession(res: any) {
  const ttlDays = Number.parseInt(process.env.CONTENT_SESSION_TTL_DAYS ?? '30', 10);
  const expiresInSeconds = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays * 24 * 60 * 60 : 30 * 24 * 60 * 60;
  const token = jwt.sign({ role: 'editor' }, getSecret(), { expiresIn: expiresInSeconds });
  const cookie = serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge: expiresInSeconds,
    domain: getCookieDomain(),
  });
  res.setHeader('Set-Cookie', cookie);
}

export function clearEditorSession(res: any) {
  const cookie = serialize(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge: 0,
    domain: getCookieDomain(),
  });
  res.setHeader('Set-Cookie', cookie);
}

export function validatePassword(input: string): boolean {
  const expected = process.env.CONTENT_ADMIN_PASSWORD ?? '';
  if (!expected) {
    throw new Error('Missing CONTENT_ADMIN_PASSWORD environment variable.');
  }
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
