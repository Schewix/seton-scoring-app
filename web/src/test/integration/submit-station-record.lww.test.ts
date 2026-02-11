import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';

function buildPayload(ctx: Awaited<ReturnType<typeof seedBase>>, overrides: Partial<any> = {}) {
  return {
    p_event_id: ctx.eventId,
    p_station_id: ctx.stationId,
    p_patrol_id: ctx.patrolId,
    p_category: 'M',
    p_arrived_at: new Date().toISOString(),
    p_wait_minutes: 1,
    p_points: 5,
    p_note: '',
    p_use_target_scoring: false,
    p_normalized_answers: null,
    p_finish_time: null,
    p_client_event_id: crypto.randomUUID(),
    p_client_created_at: new Date().toISOString(),
    p_submitted_by: ctx.judgeId,
    ...overrides,
  };
}

describe('submit_station_record rpc last-write-wins', () => {
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

  it('keeps newer write when submitted in order (A then B)', async () => {
    const t1 = new Date('2025-01-01T10:00:00.000Z').toISOString();
    const t2 = new Date('2025-01-01T10:01:00.000Z').toISOString();

    await supabaseAdmin.rpc('submit_station_record', buildPayload(ctx, { p_points: 10, p_client_created_at: t1 }));
    await supabaseAdmin.rpc('submit_station_record', buildPayload(ctx, { p_points: 20, p_client_created_at: t2 }));

    const { data: score } = await supabaseAdmin
      .from('station_scores')
      .select('points, client_created_at')
      .eq('event_id', ctx.eventId)
      .eq('station_id', ctx.stationId)
      .eq('patrol_id', ctx.patrolId)
      .maybeSingle();

    expect(score?.points).toBe(20);
    expect(new Date(score?.client_created_at ?? 0).toISOString()).toBe(t2);
  });

  it('keeps newer write when submitted out of order (B then A)', async () => {
    const t1 = new Date('2025-01-01T10:00:00.000Z').toISOString();
    const t2 = new Date('2025-01-01T10:01:00.000Z').toISOString();

    await supabaseAdmin.rpc('submit_station_record', buildPayload(ctx, { p_points: 20, p_client_created_at: t2 }));
    await supabaseAdmin.rpc('submit_station_record', buildPayload(ctx, { p_points: 10, p_client_created_at: t1 }));

    const { data: score } = await supabaseAdmin
      .from('station_scores')
      .select('points, client_created_at')
      .eq('event_id', ctx.eventId)
      .eq('station_id', ctx.stationId)
      .eq('patrol_id', ctx.patrolId)
      .maybeSingle();

    expect(score?.points).toBe(20);
    expect(new Date(score?.client_created_at ?? 0).toISOString()).toBe(t2);
  });
});
