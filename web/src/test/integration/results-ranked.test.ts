import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from './supabaseTestUtils';

type PatrolScenario = {
  id: string;
  code: string;
  teamName: string;
  pureSeconds: number;
  pointsByStation: {
    A: number;
    B: number;
    C: number;
    T: number;
  };
};

type RankedRow = {
  patrol_code: string;
  rank_in_bracket: number | string | null;
  total_points: number | string | null;
  points_no_t: number | string | null;
  pure_seconds: number | string | null;
  points_12_count: number | string | null;
  points_11_count: number | string | null;
  points_10_count: number | string | null;
  points_9_count: number | string | null;
  points_8_count: number | string | null;
  points_7_count: number | string | null;
  points_6_count: number | string | null;
  points_5_count: number | string | null;
  points_4_count: number | string | null;
  points_3_count: number | string | null;
  points_2_count: number | string | null;
  points_1_count: number | string | null;
  points_0_count: number | string | null;
};

const seed = {
  eventId: crypto.randomUUID(),
  stations: {
    A: crypto.randomUUID(),
    B: crypto.randomUUID(),
    C: crypto.randomUUID(),
    T: crypto.randomUUID(),
  },
  patrols: {
    c1Winner: {
      id: crypto.randomUUID(),
      code: 'MH-C1-W',
      teamName: 'Pair C1 winner',
      pureSeconds: 3600,
      pointsByStation: { A: 10, B: 10, C: 0, T: 8 },
    },
    c1Loser: {
      id: crypto.randomUUID(),
      code: 'MH-C1-L',
      teamName: 'Pair C1 loser',
      pureSeconds: 3600,
      pointsByStation: { A: 10, B: 10, C: 0, T: 7 },
    },
    c2Winner: {
      id: crypto.randomUUID(),
      code: 'MH-C2-W',
      teamName: 'Pair C2 winner',
      pureSeconds: 3600,
      pointsByStation: { A: 10, B: 9, C: 0, T: 7 },
    },
    c2Loser: {
      id: crypto.randomUUID(),
      code: 'MH-C2-L',
      teamName: 'Pair C2 loser',
      pureSeconds: 3600,
      pointsByStation: { A: 10, B: 8, C: 0, T: 8 },
    },
    c3Winner: {
      id: crypto.randomUUID(),
      code: 'MH-C3-W',
      teamName: 'Pair C3 winner',
      pureSeconds: 3500,
      pointsByStation: { A: 11, B: 11, C: 0, T: 8 },
    },
    c3Loser: {
      id: crypto.randomUUID(),
      code: 'MH-C3-L',
      teamName: 'Pair C3 loser',
      pureSeconds: 3600,
      pointsByStation: { A: 11, B: 11, C: 0, T: 8 },
    },
    c4Winner: {
      id: crypto.randomUUID(),
      code: 'MH-C4-W',
      teamName: 'Pair C4 winner',
      pureSeconds: 3600,
      pointsByStation: { A: 12, B: 12, C: 2, T: 8 },
    },
    c4Loser: {
      id: crypto.randomUUID(),
      code: 'MH-C4-L',
      teamName: 'Pair C4 loser',
      pureSeconds: 3600,
      pointsByStation: { A: 11, B: 11, C: 4, T: 8 },
    },
    c5Winner: {
      id: crypto.randomUUID(),
      code: 'MH-C5-W',
      teamName: 'Pair C5 winner',
      pureSeconds: 3600,
      pointsByStation: { A: 11, B: 10, C: 9, T: 8 },
    },
    c5Loser: {
      id: crypto.randomUUID(),
      code: 'MH-C5-L',
      teamName: 'Pair C5 loser',
      pureSeconds: 3600,
      pointsByStation: { A: 10, B: 10, C: 10, T: 8 },
    },
    tieA: {
      id: crypto.randomUUID(),
      code: 'MH-TIE-A',
      teamName: 'Tie A',
      pureSeconds: 3700,
      pointsByStation: { A: 12, B: 11, C: 11, T: 8 },
    },
    tieB: {
      id: crypto.randomUUID(),
      code: 'MH-TIE-B',
      teamName: 'Tie B',
      pureSeconds: 3700,
      pointsByStation: { A: 12, B: 11, C: 11, T: 8 },
    },
  } satisfies Record<string, PatrolScenario>,
};

function asNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function expectNoError(error: { message?: string } | null, context: string) {
  if (!error) {
    return;
  }
  throw new Error(`${context}: ${error.message ?? 'unknown error'}`);
}

function addSeconds(iso: string, seconds: number) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

beforeAll(async () => {
  const { error: eventError } = await supabaseAdmin.from('events').insert({
    id: seed.eventId,
    name: `Integration results ranked ${seed.eventId.slice(0, 8)}`,
    scoring_locked: false,
  });
  expectNoError(eventError, 'insert event');

  const stationRows = [
    { id: seed.stations.A, event_id: seed.eventId, code: 'A', name: 'Stanoviste A' },
    { id: seed.stations.B, event_id: seed.eventId, code: 'B', name: 'Stanoviste B' },
    { id: seed.stations.C, event_id: seed.eventId, code: 'C', name: 'Stanoviste C' },
    { id: seed.stations.T, event_id: seed.eventId, code: 'T', name: 'Cas z trati' },
  ];
  const { error: stationError } = await supabaseAdmin.from('stations').insert(stationRows);
  expectNoError(stationError, 'insert stations');

  const patrolRows = Object.values(seed.patrols).map((patrol) => ({
    id: patrol.id,
    event_id: seed.eventId,
    team_name: patrol.teamName,
    category: 'M',
    sex: 'H',
    patrol_code: patrol.code,
    active: true,
  }));
  const { error: patrolError } = await supabaseAdmin.from('patrols').insert(patrolRows);
  expectNoError(patrolError, 'insert patrols');

  const scoreRows = Object.values(seed.patrols).flatMap((patrol) => [
    {
      event_id: seed.eventId,
      patrol_id: patrol.id,
      station_id: seed.stations.A,
      points: patrol.pointsByStation.A,
    },
    {
      event_id: seed.eventId,
      patrol_id: patrol.id,
      station_id: seed.stations.B,
      points: patrol.pointsByStation.B,
    },
    {
      event_id: seed.eventId,
      patrol_id: patrol.id,
      station_id: seed.stations.C,
      points: patrol.pointsByStation.C,
    },
    {
      event_id: seed.eventId,
      patrol_id: patrol.id,
      station_id: seed.stations.T,
      points: patrol.pointsByStation.T,
    },
  ]);
  const { error: scoreError } = await supabaseAdmin.from('station_scores').insert(scoreRows);
  expectNoError(scoreError, 'insert station_scores');

  const startTime = '2026-01-01T10:00:00.000Z';
  const timingRows = Object.values(seed.patrols).map((patrol) => ({
    event_id: seed.eventId,
    patrol_id: patrol.id,
    start_time: startTime,
    finish_time: addSeconds(startTime, patrol.pureSeconds),
  }));
  const { error: timingError } = await supabaseAdmin.from('timings').insert(timingRows);
  expectNoError(timingError, 'insert timings');
});

afterAll(async () => {
  await supabaseAdmin.from('events').delete().eq('id', seed.eventId);
});

describe('results_ranked tie-break criteria 1-5', () => {
  it('resolves ordering step by step and keeps final full ties on shared rank', async () => {
    const { data, error } = await supabaseAdmin
      .from('results_ranked')
      .select(
        'patrol_code, rank_in_bracket, total_points, points_no_t, pure_seconds, points_12_count, points_11_count, points_10_count, points_9_count, points_8_count, points_7_count, points_6_count, points_5_count, points_4_count, points_3_count, points_2_count, points_1_count, points_0_count',
      )
      .eq('event_id', seed.eventId)
      .eq('category', 'M')
      .eq('sex', 'H');
    expectNoError(error, 'select results_ranked');

    const byCode = new Map((data ?? []).map((row) => [row.patrol_code, row as RankedRow]));
    expect(byCode.size).toBe(Object.keys(seed.patrols).length);

    const row = (code: string) => {
      const found = byCode.get(code);
      if (!found) {
        throw new Error(`Missing row for patrol_code=${code}`);
      }
      return found;
    };

    const c1Winner = row(seed.patrols.c1Winner.code);
    const c1Loser = row(seed.patrols.c1Loser.code);
    expect(asNumber(c1Winner.total_points)).toBeGreaterThan(asNumber(c1Loser.total_points));
    expect(asNumber(c1Winner.rank_in_bracket)).toBeLessThan(asNumber(c1Loser.rank_in_bracket));

    const c2Winner = row(seed.patrols.c2Winner.code);
    const c2Loser = row(seed.patrols.c2Loser.code);
    expect(asNumber(c2Winner.total_points)).toBe(asNumber(c2Loser.total_points));
    expect(asNumber(c2Winner.points_no_t)).toBeGreaterThan(asNumber(c2Loser.points_no_t));
    expect(asNumber(c2Winner.rank_in_bracket)).toBeLessThan(asNumber(c2Loser.rank_in_bracket));

    const c3Winner = row(seed.patrols.c3Winner.code);
    const c3Loser = row(seed.patrols.c3Loser.code);
    expect(asNumber(c3Winner.total_points)).toBe(asNumber(c3Loser.total_points));
    expect(asNumber(c3Winner.points_no_t)).toBe(asNumber(c3Loser.points_no_t));
    expect(asNumber(c3Winner.pure_seconds)).toBeLessThan(asNumber(c3Loser.pure_seconds));
    expect(asNumber(c3Winner.rank_in_bracket)).toBeLessThan(asNumber(c3Loser.rank_in_bracket));

    const c4Winner = row(seed.patrols.c4Winner.code);
    const c4Loser = row(seed.patrols.c4Loser.code);
    expect(asNumber(c4Winner.total_points)).toBe(asNumber(c4Loser.total_points));
    expect(asNumber(c4Winner.points_no_t)).toBe(asNumber(c4Loser.points_no_t));
    expect(asNumber(c4Winner.pure_seconds)).toBe(asNumber(c4Loser.pure_seconds));
    expect(asNumber(c4Winner.points_12_count)).toBeGreaterThan(asNumber(c4Loser.points_12_count));
    expect(asNumber(c4Winner.rank_in_bracket)).toBeLessThan(asNumber(c4Loser.rank_in_bracket));

    const c5Winner = row(seed.patrols.c5Winner.code);
    const c5Loser = row(seed.patrols.c5Loser.code);
    expect(asNumber(c5Winner.total_points)).toBe(asNumber(c5Loser.total_points));
    expect(asNumber(c5Winner.points_no_t)).toBe(asNumber(c5Loser.points_no_t));
    expect(asNumber(c5Winner.pure_seconds)).toBe(asNumber(c5Loser.pure_seconds));
    expect(asNumber(c5Winner.points_12_count)).toBe(asNumber(c5Loser.points_12_count));
    expect(asNumber(c5Winner.points_11_count)).toBeGreaterThan(asNumber(c5Loser.points_11_count));
    expect(asNumber(c5Winner.rank_in_bracket)).toBeLessThan(asNumber(c5Loser.rank_in_bracket));

    const tieA = row(seed.patrols.tieA.code);
    const tieB = row(seed.patrols.tieB.code);
    expect(asNumber(tieA.total_points)).toBe(asNumber(tieB.total_points));
    expect(asNumber(tieA.points_no_t)).toBe(asNumber(tieB.points_no_t));
    expect(asNumber(tieA.pure_seconds)).toBe(asNumber(tieB.pure_seconds));
    expect(asNumber(tieA.points_12_count)).toBe(asNumber(tieB.points_12_count));
    expect(asNumber(tieA.points_11_count)).toBe(asNumber(tieB.points_11_count));
    expect(asNumber(tieA.points_10_count)).toBe(asNumber(tieB.points_10_count));
    expect(asNumber(tieA.points_9_count)).toBe(asNumber(tieB.points_9_count));
    expect(asNumber(tieA.points_8_count)).toBe(asNumber(tieB.points_8_count));
    expect(asNumber(tieA.points_7_count)).toBe(asNumber(tieB.points_7_count));
    expect(asNumber(tieA.points_6_count)).toBe(asNumber(tieB.points_6_count));
    expect(asNumber(tieA.points_5_count)).toBe(asNumber(tieB.points_5_count));
    expect(asNumber(tieA.points_4_count)).toBe(asNumber(tieB.points_4_count));
    expect(asNumber(tieA.points_3_count)).toBe(asNumber(tieB.points_3_count));
    expect(asNumber(tieA.points_2_count)).toBe(asNumber(tieB.points_2_count));
    expect(asNumber(tieA.points_1_count)).toBe(asNumber(tieB.points_1_count));
    expect(asNumber(tieA.points_0_count)).toBe(asNumber(tieB.points_0_count));
    expect(asNumber(tieA.rank_in_bracket)).toBe(asNumber(tieB.rank_in_bracket));
  });
});
