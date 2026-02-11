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

describe('submit-station-record api', () => {
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

  it('happy path without quiz/timing', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: passages } = await supabaseAdmin
      .from('station_passages')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: timings } = await supabaseAdmin
      .from('timings')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: quiz } = await supabaseAdmin
      .from('station_quiz_responses')
      .select('*')
      .eq('event_id', ctx.eventId);

    expect(scores?.length).toBe(1);
    expect(passages?.length).toBe(1);
    expect(timings?.length ?? 0).toBe(0);
    expect(quiz?.length ?? 0).toBe(0);
  });

  it('happy path with timing', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload({ finish_time: new Date().toISOString() }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const { data: timings } = await supabaseAdmin
      .from('timings')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(timings?.length).toBe(1);
  });

  it('target scoring stores quiz responses and is idempotent', async () => {
    const payload = basePayload({
      use_target_scoring: true,
      normalized_answers: 'ABCD',
      points: 4,
    });
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };

    const res1 = createMockRes();
    await handler(req, res1);
    const res2 = createMockRes();
    await handler(req, res2);

    const { data: quiz } = await supabaseAdmin
      .from('station_quiz_responses')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(quiz?.length).toBe(1);
  });

  it('deletes quiz responses when use_target_scoring=false', async () => {
    const payload = basePayload({
      use_target_scoring: true,
      normalized_answers: 'AB',
      points: 2,
    });

    await handler(
      { method: 'POST', headers: { authorization: `Bearer ${ctx.accessToken}` }, body: payload } as any,
      createMockRes(),
    );

    await handler(
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.accessToken}` },
        body: { ...payload, use_target_scoring: false, normalized_answers: null, points: 5 },
      } as any,
      createMockRes(),
    );

    const { data: quiz } = await supabaseAdmin
      .from('station_quiz_responses')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(quiz?.length ?? 0).toBe(0);
  });

  it('idempotence across tables for same client_event_id', async () => {
    const payload = basePayload({ client_event_id: crypto.randomUUID() });
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };

    await handler(req, createMockRes());
    await handler(req, createMockRes());
    await handler(req, createMockRes());

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: passages } = await supabaseAdmin
      .from('station_passages')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: timings } = await supabaseAdmin
      .from('timings')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: quiz } = await supabaseAdmin
      .from('station_quiz_responses')
      .select('*')
      .eq('event_id', ctx.eventId);

    expect(scores?.length).toBe(1);
    expect(passages?.length).toBe(1);
    expect(timings?.length ?? 0).toBe(0);
    expect(quiz?.length ?? 0).toBe(0);
  });

  it('does not write partial data on failure', async () => {
    const payload = basePayload({ patrol_id: crypto.randomUUID() });
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(500);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: passages } = await supabaseAdmin
      .from('station_passages')
      .select('*')
      .eq('event_id', ctx.eventId);

    expect(scores?.length ?? 0).toBe(0);
    expect(passages?.length ?? 0).toBe(0);
  });

  it('auth: missing session => 401', async () => {
    const req: any = { method: 'POST', headers: {}, body: basePayload() };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('auth: no judge assignment => 403', async () => {
    await supabaseAdmin
      .from('judge_assignments')
      .delete()
      .eq('judge_id', ctx.judgeId)
      .eq('event_id', ctx.eventId)
      .eq('station_id', ctx.stationId);

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: basePayload(),
    };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('patrol_code lookup inserts when patrol_id missing', async () => {
    const payload = basePayload({ patrol_id: 'not-a-uuid' });
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };

    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(scores?.length).toBe(1);
  });

  it('invalid patrol_code returns 400 and writes nothing', async () => {
    const payload = basePayload({ patrol_id: 'not-a-uuid', patrol_code: 'ZZ-99' });
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: payload,
    };

    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(scores?.length ?? 0).toBe(0);
  });
});
