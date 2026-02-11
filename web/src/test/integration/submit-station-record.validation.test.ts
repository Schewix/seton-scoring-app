import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../../api/submit-station-record';
import { resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';

function createMockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (key: string, value: string) => {
    res.headers[key] = value;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.payload = payload;
    return res;
  };
  res.end = () => res;
  return res;
}

function basePayload(ctx: Awaited<ReturnType<typeof seedBase>>, overrides: Partial<any> = {}) {
  return {
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
    ...overrides,
  };
}

async function expectNoWrites(eventId: string) {
  const { data: scores } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('event_id', eventId);
  const { data: passages } = await supabaseAdmin
    .from('station_passages')
    .select('*')
    .eq('event_id', eventId);
  const { data: timings } = await supabaseAdmin.from('timings').select('*').eq('event_id', eventId);
  const { data: quiz } = await supabaseAdmin
    .from('station_quiz_responses')
    .select('*')
    .eq('event_id', eventId);

  expect(scores?.length ?? 0).toBe(0);
  expect(passages?.length ?? 0).toBe(0);
  expect(timings?.length ?? 0).toBe(0);
  expect(quiz?.length ?? 0).toBe(0);
}

describe('submit-station-record api validation', () => {
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

  it('rejects invalid arrived_at values', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(ctx, { arrived_at: 'not-a-date' }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    await expectNoWrites(ctx.eventId);
  });

  it('rejects non-numeric wait_minutes', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(ctx, { wait_minutes: '5' }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    await expectNoWrites(ctx.eventId);
  });

  it('rejects non-numeric points', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(ctx, { points: '7' }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    await expectNoWrites(ctx.eventId);
  });

  it('rejects missing required fields', async () => {
    const payload = basePayload(ctx);
    delete (payload as any).event_id;

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    await expectNoWrites(ctx.eventId);
  });

  it('rejects invalid client_created_at timestamps', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(ctx, { client_created_at: 'invalid-time' }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    await expectNoWrites(ctx.eventId);
  });
});
