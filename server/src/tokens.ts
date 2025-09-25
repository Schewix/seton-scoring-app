import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from './env.js';

interface TokenPayload {
  sub: string;
  stationId: string;
  sessionId: string;
  eventId: string;
  type: 'access' | 'refresh';
}

export function createAccessToken(payload: Omit<TokenPayload, 'type'>) {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function createRefreshToken(payload: Omit<TokenPayload, 'type'>) {
  return jwt.sign({ ...payload, type: 'refresh' }, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashRefreshToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
