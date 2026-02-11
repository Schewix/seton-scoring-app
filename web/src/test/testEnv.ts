import jwt from 'jsonwebtoken';

const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';
const DEFAULT_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const DEFAULT_REFRESH_SECRET = 'super-secret-refresh-token-with-at-least-32-characters-long';

function readEnv(key: string) {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : '';
}

function signKey(secret: string, role: string) {
  return jwt.sign({ role }, secret, { expiresIn: '10y' });
}

export function ensureTestSupabaseEnv() {
  const currentUrl = readEnv('SUPABASE_URL');
  if (!currentUrl) {
    process.env.SUPABASE_URL = DEFAULT_SUPABASE_URL;
  }

  const jwtSecret =
    readEnv('SUPABASE_JWT_SECRET') || readEnv('JWT_SECRET') || DEFAULT_JWT_SECRET;
  if (!readEnv('SUPABASE_JWT_SECRET') && !readEnv('JWT_SECRET')) {
    process.env.SUPABASE_JWT_SECRET = jwtSecret;
  }

  if (!readEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = signKey(jwtSecret, 'service_role');
  }

  if (!readEnv('SUPABASE_ANON_KEY')) {
    process.env.SUPABASE_ANON_KEY = signKey(jwtSecret, 'anon');
  }

  if (!readEnv('REFRESH_TOKEN_SECRET') && !readEnv('JWT_REFRESH_SECRET')) {
    process.env.REFRESH_TOKEN_SECRET = DEFAULT_REFRESH_SECRET;
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    jwtSecret,
  };
}
