import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';

describe('submit_station_record rpc rollback', () => {
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

  it('rolls back all writes when station_scores insert fails', async () => {
    const { error } = await supabaseAdmin.rpc('submit_station_record', {
      p_event_id: ctx.eventId,
      p_station_id: ctx.stationId,
      p_patrol_id: ctx.patrolId,
      p_category: 'M',
      p_arrived_at: new Date().toISOString(),
      p_wait_minutes: 1,
      p_points: null,
      p_note: 'rollback',
      p_use_target_scoring: true,
      p_normalized_answers: 'ABCD',
      p_finish_time: new Date().toISOString(),
      p_client_event_id: crypto.randomUUID(),
      p_client_created_at: new Date().toISOString(),
      p_submitted_by: ctx.judgeId,
    } as any);

    expect(error).toBeTruthy();

    const { data: scores } = await supabaseAdmin
      .from('station_scores')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: passages } = await supabaseAdmin
      .from('station_passages')
      .select('*')
      .eq('event_id', ctx.eventId);
    const { data: timings } = await supabaseAdmin.from('timings').select('*').eq('event_id', ctx.eventId);
    const { data: quiz } = await supabaseAdmin
      .from('station_quiz_responses')
      .select('*')
      .eq('event_id', ctx.eventId);

    expect(scores?.length ?? 0).toBe(0);
    expect(passages?.length ?? 0).toBe(0);
    expect(timings?.length ?? 0).toBe(0);
    expect(quiz?.length ?? 0).toBe(0);
  });
});
