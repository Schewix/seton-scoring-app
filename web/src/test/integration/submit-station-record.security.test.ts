import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler from '../../../api/submit-station-record';
import { createAccessToken, resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';

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

async function seedEventWithStationAndPatrol() {
  const eventId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const patrolId = crypto.randomUUID();
  const patrolCode = 'MH-99';

  await supabaseAdmin.from('events').insert({ id: eventId, name: 'Other Event', scoring_locked: false });
  await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'Y', name: 'Other Station' });
  await supabaseAdmin.from('patrols').insert({
    id: patrolId,
    event_id: eventId,
    team_name: 'Other Patrol',
    category: 'M',
    sex: 'H',
    patrol_code: patrolCode,
    active: true,
  });

  return { eventId, stationId, patrolId, patrolCode };
}

async function seedSessionForStation(params: { judgeId: string; stationId: string }) {
  const sessionId = crypto.randomUUID();
  const refreshExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('judge_sessions').insert({
    id: sessionId,
    judge_id: params.judgeId,
    station_id: params.stationId,
    device_salt: `salt-${sessionId}`,
    public_key: `pub-${sessionId}`,
    manifest_version: 1,
    refresh_token_hash: `hash-${sessionId}`,
    refresh_token_expires_at: refreshExpiresAt,
  });
  if (error) {
    throw new Error(`seed judge_session failed: ${error.message ?? 'unknown-error'}`);
  }
  return sessionId;
}

describe('submit-station-record api security', () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  let other: Awaited<ReturnType<typeof seedEventWithStationAndPatrol>> | null = null;
  let stationOtherId: string | null = null;

  beforeEach(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
    ctx = await seedBase();
    other = await seedEventWithStationAndPatrol();

    stationOtherId = crypto.randomUUID();
    await supabaseAdmin
      .from('stations')
      .insert({ id: stationOtherId, event_id: ctx.eventId, code: 'Q', name: 'Unassigned Station' });
  }); 

  afterEach(async () => {
    if (other) {
      await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('station_scores').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('station_passages').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('timings').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('stations').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('patrols').delete().eq('event_id', other.eventId);
      await supabaseAdmin.from('events').delete().eq('id', other.eventId);
      other = null;
    }
  });

  afterAll(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
  });

  it('blocks judge token from event X writing to event Y', async () => {
    const token = createAccessToken({
      sub: ctx.judgeId,
      sessionId: ctx.sessionId,
      eventId: ctx.eventId,
      stationId: ctx.stationId,
    });

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: basePayload(ctx, {
        event_id: other?.eventId,
        station_id: other?.stationId,
        patrol_id: other?.patrolId,
        patrol_code: other?.patrolCode,
      }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(403);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', other?.eventId ?? '');
    expect(scores?.length ?? 0).toBe(0);
  });

  it('blocks judge without station assignment', async () => {
    const stationSessionId = await seedSessionForStation({
      judgeId: ctx.judgeId,
      stationId: stationOtherId ?? '',
    });

    const token = createAccessToken({
      sub: ctx.judgeId,
      sessionId: stationSessionId,
      eventId: ctx.eventId,
      stationId: stationOtherId ?? '',
    });

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: basePayload(ctx, {
        station_id: stationOtherId,
      }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(403);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(scores?.length ?? 0).toBe(0);
  });

  it('allows station T to write score for other station in same event', async () => {
    const calcStationId = crypto.randomUUID();
    const calcSessionId = crypto.randomUUID();
    const refreshExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('stations')
      .insert({ id: calcStationId, event_id: ctx.eventId, code: 'T', name: 'Výpočetka' });

    await supabaseAdmin.from('judge_assignments').insert({
      judge_id: ctx.judgeId,
      station_id: calcStationId,
      event_id: ctx.eventId,
      allowed_categories: ['M'],
      allowed_tasks: [],
    });

    await supabaseAdmin.from('judge_sessions').insert({
      id: calcSessionId,
      judge_id: ctx.judgeId,
      station_id: calcStationId,
      device_salt: 'salt-calc',
      public_key: 'pub-calc',
      manifest_version: 1,
      refresh_token_hash: 'hash-calc',
      refresh_token_expires_at: refreshExpiresAt,
    });

    const token = createAccessToken({
      sub: ctx.judgeId,
      sessionId: calcSessionId,
      eventId: ctx.eventId,
      stationId: calcStationId,
    });

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: basePayload(ctx, {
        station_id: stationOtherId,
      }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId)
      .eq('station_id', stationOtherId ?? '')
      .eq('patrol_id', ctx.patrolId);

    expect(scores?.length ?? 0).toBe(1);
  });

  it('rejects event/station mismatch combinations', async () => {
    const mismatchSessionId = await seedSessionForStation({
      judgeId: ctx.judgeId,
      stationId: other?.stationId ?? '',
    });

    const token = createAccessToken({
      sub: ctx.judgeId,
      sessionId: mismatchSessionId,
      eventId: ctx.eventId,
      stationId: other?.stationId ?? '',
    });

    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: basePayload(ctx, {
        station_id: other?.stationId,
      }),
    };
    const res = createMockRes();

    await handler(req, res);
    expect(res.statusCode).toBe(403);

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    expect(scores?.length ?? 0).toBe(0);
  });
});
