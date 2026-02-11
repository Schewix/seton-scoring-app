import { defineConfig } from '@playwright/test';
import { bypassClaims, bypassPatrols, seedData } from './e2e/seedData';
import { createTestJwt } from './e2e/utils';
import { ensureTestSupabaseEnv } from './src/test/testEnv';

const { supabaseUrl: baseSupabaseUrl, anonKey: baseAnonKey, jwtSecret } = ensureTestSupabaseEnv();
const supabaseUrl = process.env.PLAYWRIGHT_SUPABASE_URL ?? baseSupabaseUrl;
const anonKey = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY ?? baseAnonKey;

if (!anonKey) {
  throw new Error('Missing SUPABASE_ANON_KEY for E2E tests.');
}
if (!jwtSecret) {
  throw new Error('Missing SUPABASE_JWT_SECRET (or JWT_SECRET) for E2E tests.');
}

process.env.SUPABASE_URL = supabaseUrl;
process.env.SUPABASE_ANON_KEY = anonKey;

const bypassToken = createTestJwt(bypassClaims);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    env: {
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
      VITE_AUTH_BYPASS: 'true',
      VITE_AUTH_BYPASS_TOKEN: bypassToken,
      VITE_AUTH_BYPASS_PATROLS: bypassPatrols,
      VITE_EVENT_ID: seedData.eventId,
      VITE_STATION_ID: seedData.stationId,
    },
  },
  globalSetup: './e2e/global-setup.ts',
});
