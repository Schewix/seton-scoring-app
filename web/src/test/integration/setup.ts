import { beforeAll } from 'vitest';
import { ensureTestSupabaseEnv } from '../testEnv';

beforeAll(() => {
  const { supabaseUrl, serviceRoleKey, jwtSecret } = ensureTestSupabaseEnv();
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? process.env.JWT_REFRESH_SECRET ?? '';

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL for integration tests.');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for integration tests.');
  }
  if (!jwtSecret) {
    throw new Error('Missing SUPABASE_JWT_SECRET (or JWT_SECRET) for integration tests.');
  }
  if (!refreshSecret) {
    throw new Error('Missing REFRESH_TOKEN_SECRET (or JWT_REFRESH_SECRET) for integration tests.');
  }
});
