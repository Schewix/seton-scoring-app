import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';
import { ensureTestSupabaseEnv } from '../testEnv';

const { supabaseUrl, anonKey, serviceRoleKey } = ensureTestSupabaseEnv();
const FUNCTIONS_BASE_URL = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
const API_KEY = anonKey || serviceRoleKey;

function buildHeaders(accessToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (API_KEY) {
    headers.apikey = API_KEY;
  }
  return headers;
}

describe('submit-station-record edge function', () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
    ctx = await seedBase();
  });

  afterAll(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
  });

  const basePayload = (override: Partial<any> = {}) => ({
    client_event_id: crypto.randomUUID(),
    client_created_at: new Date().toISOString(),
    event_id: ctx.eventId,
    station_id: ctx.stationId,
    patrol_id: ctx.patrolId,
    category: 'M',
    arrived_at: new Date().toISOString(),
    wait_minutes: 1,
    points: 5,
    note: '',
    use_target_scoring: false,
    normalized_answers: null,
    finish_time: null,
    patrol_code: ctx.patrolCode,
    team_name: 'Test patrol',
    sex: 'H',
    ...override,
  });

  it('rejects missing session', async () => {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/submit-station-record`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(basePayload()),
    });

    expect(response.status).toBe(401);
  });

  it('accepts valid payload and is idempotent', async () => {
    const payload = basePayload({ client_event_id: crypto.randomUUID() });
    const request = () =>
      fetch(`${FUNCTIONS_BASE_URL}/submit-station-record`, {
        method: 'POST',
        headers: buildHeaders(ctx.accessToken),
        body: JSON.stringify(payload),
      });

    const res1 = await request();
    const res2 = await request();
    const res3 = await request();

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: passages } = await supabaseAdmin
      .from('station_passages')
      .select('*')
      .eq('event_id', ctx.eventId);

    expect(scores?.length).toBe(1);
    expect(passages?.length).toBe(1);
  });

  it('rejects mismatched event/station', async () => {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/submit-station-record`, {
      method: 'POST',
      headers: buildHeaders(ctx.accessToken),
      body: JSON.stringify(basePayload({ event_id: crypto.randomUUID() })),
    });

    expect(response.status).toBe(403);
  });
});
