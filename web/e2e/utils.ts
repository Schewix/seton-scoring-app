import jwt from 'jsonwebtoken';
import { ensureTestSupabaseEnv } from '../src/test/testEnv';

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createTestJwt(payload: Record<string, unknown>) {
  const { jwtSecret } = ensureTestSupabaseEnv();
  if (jwtSecret) {
    return jwt.sign(payload, jwtSecret, { expiresIn: 60 * 60 });
  }

  const header = { alg: 'none', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedHeader}.${encodedPayload}.test`;
}
