import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 14;
const MIN_SECRET_LENGTH = 10;

type AuthConfig = {
  jwtSecret: string;
  refreshSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

let cachedConfig: AuthConfig | null = null;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET ?? '';
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? process.env.JWT_REFRESH_SECRET ?? '';

  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('Missing JWT_SECRET environment variable.');
  }

  if (refreshSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('Missing REFRESH_TOKEN_SECRET environment variable.');
  }

  const accessTokenTtlSeconds = parsePositiveInt(
    process.env.ACCESS_TOKEN_TTL_SECONDS ?? process.env.JWT_EXPIRES_IN,
    DEFAULT_ACCESS_TTL_SECONDS,
  );
  const refreshTokenTtlSeconds = parsePositiveInt(
    process.env.REFRESH_TOKEN_TTL_SECONDS ?? process.env.JWT_REFRESH_EXPIRES_IN,
    DEFAULT_REFRESH_TTL_SECONDS,
  );

  cachedConfig = {
    jwtSecret,
    refreshSecret,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
  };

  return cachedConfig;
}

export function createAccessToken(payload: Record<string, unknown>) {
  const { jwtSecret, accessTokenTtlSeconds } = getAuthConfig();
  return jwt.sign(payload, jwtSecret, { expiresIn: accessTokenTtlSeconds });
}

export function createRefreshToken(payload: Record<string, unknown>) {
  const { refreshSecret, refreshTokenTtlSeconds } = getAuthConfig();
  return jwt.sign(payload, refreshSecret, { expiresIn: refreshTokenTtlSeconds });
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashRefreshToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
