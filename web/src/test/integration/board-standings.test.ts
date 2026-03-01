import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from './supabaseTestUtils';

type SeedState = {
  eventId: string;
  categoryId: string;
  gameAscId: string;
  gameDescId: string;
  playerIds: string[];
  judgeId: string;
};

const seed: SeedState = {
  eventId: crypto.randomUUID(),
  categoryId: crypto.randomUUID(),
  gameAscId: crypto.randomUUID(),
  gameDescId: crypto.randomUUID(),
  playerIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  judgeId: crypto.randomUUID(),
};

function asNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return typeof value === 'number' ? value : Number(value);
}

async function assertNoError(error: { message?: string } | null, context: string) {
  if (!error) {
    return;
  }
  throw new Error(`${context}: ${error.message ?? 'unknown error'}`);
}

beforeAll(async () => {
  const { error: eventError } = await supabaseAdmin.from('board_event').insert({
    id: seed.eventId,
    slug: `it-board-${seed.eventId.slice(0, 8)}`,
    name: 'Integration board standings',
  });
  await assertNoError(eventError, 'insert board_event');

  const { error: categoryError } = await supabaseAdmin.from('board_category').insert({
    id: seed.categoryId,
    event_id: seed.eventId,
    name: 'Kategorie V',
    primary_game_id: null,
  });
  await assertNoError(categoryError, 'insert board_category');

  const { error: gameError } = await supabaseAdmin.from('board_game').insert([
    {
      id: seed.gameAscId,
      event_id: seed.eventId,
      name: 'Dobble',
      scoring_type: 'both',
      points_order: 'asc',
      three_player_adjustment: false,
    },
    {
      id: seed.gameDescId,
      event_id: seed.eventId,
      name: 'Kris kros',
      scoring_type: 'both',
      points_order: 'desc',
      three_player_adjustment: false,
    },
  ]);
  await assertNoError(gameError, 'insert board_game');

  const { error: categoryUpdateError } = await supabaseAdmin
    .from('board_category')
    .update({ primary_game_id: seed.gameDescId })
    .eq('id', seed.categoryId);
  await assertNoError(categoryUpdateError, 'update board_category.primary_game_id');

  const blockAscId = crypto.randomUUID();
  const blockDescId = crypto.randomUUID();

  const { error: blockError } = await supabaseAdmin.from('board_block').insert([
    {
      id: blockAscId,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_number: 1,
      game_id: seed.gameAscId,
    },
    {
      id: blockDescId,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_number: 2,
      game_id: seed.gameDescId,
    },
  ]);
  await assertNoError(blockError, 'insert board_block');

  const { error: playersError } = await supabaseAdmin.from('board_player').insert(
    seed.playerIds.map((playerId, index) => ({
      id: playerId,
      event_id: seed.eventId,
      short_code: `RH-${index + 1}`,
      team_name: `${index + 1}. PTO`,
      display_name: `Hrac ${index + 1}`,
      category_id: seed.categoryId,
      disqualified: false,
    })),
  );
  await assertNoError(playersError, 'insert board_player');

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: seed.judgeId,
    email: `board-it-${seed.judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Board Integration Judge',
  });
  await assertNoError(judgeError, 'insert judge');

  const [matchAsc1Id, matchAsc2Id, matchDesc1Id, matchDesc2Id] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];

  const { error: matchError } = await supabaseAdmin.from('board_match').insert([
    {
      id: matchAsc1Id,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_id: blockAscId,
      round_number: 1,
      table_number: 1,
      created_by: seed.judgeId,
      status: 'submitted',
    },
    {
      id: matchAsc2Id,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_id: blockAscId,
      round_number: 2,
      table_number: 1,
      created_by: seed.judgeId,
      status: 'submitted',
    },
    {
      id: matchDesc1Id,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_id: blockDescId,
      round_number: 1,
      table_number: 1,
      created_by: seed.judgeId,
      status: 'submitted',
    },
    {
      id: matchDesc2Id,
      event_id: seed.eventId,
      category_id: seed.categoryId,
      block_id: blockDescId,
      round_number: 2,
      table_number: 1,
      created_by: seed.judgeId,
      status: 'submitted',
    },
  ]);
  await assertNoError(matchError, 'insert board_match');

  const [p1, p2, p3, p4] = seed.playerIds;
  const matchRows = [
    // Dobble (asc): p1 > p2 > p4 > p3 in final ranking
    { match_id: matchAsc1Id, player_id: p1, seat: 1, points: 10, placement: 1 },
    { match_id: matchAsc1Id, player_id: p2, seat: 2, points: 20, placement: 2 },
    { match_id: matchAsc1Id, player_id: p3, seat: 3, points: 30, placement: 3 },
    { match_id: matchAsc1Id, player_id: p4, seat: 4, points: 40, placement: 4 },
    { match_id: matchAsc2Id, player_id: p1, seat: 1, points: 20, placement: 2 },
    { match_id: matchAsc2Id, player_id: p2, seat: 2, points: 15, placement: 1 },
    { match_id: matchAsc2Id, player_id: p3, seat: 3, points: 50, placement: 4 },
    { match_id: matchAsc2Id, player_id: p4, seat: 4, points: 35, placement: 3 },
    // Kris kros (desc): p2 > p3 > p1 > p4 in final ranking
    { match_id: matchDesc1Id, player_id: p1, seat: 1, points: 30, placement: 2 },
    { match_id: matchDesc1Id, player_id: p2, seat: 2, points: 35, placement: 1 },
    { match_id: matchDesc1Id, player_id: p3, seat: 3, points: 20, placement: 3 },
    { match_id: matchDesc1Id, player_id: p4, seat: 4, points: 5, placement: 4 },
    { match_id: matchDesc2Id, player_id: p1, seat: 1, points: 10, placement: 3 },
    { match_id: matchDesc2Id, player_id: p2, seat: 2, points: 15, placement: 2 },
    { match_id: matchDesc2Id, player_id: p3, seat: 3, points: 25, placement: 1 },
    { match_id: matchDesc2Id, player_id: p4, seat: 4, points: 8, placement: 4 },
  ];

  const { error: rowsError } = await supabaseAdmin.from('board_match_player').insert(matchRows);
  await assertNoError(rowsError, 'insert board_match_player');
});

afterAll(async () => {
  await supabaseAdmin.from('board_event').delete().eq('id', seed.eventId);
  await supabaseAdmin.from('judges').delete().eq('id', seed.judgeId);
});

describe('board standings DB views', () => {
  it('board_game_standings computes ranking, points and placement sums', async () => {
    const { data, error } = await supabaseAdmin
      .from('board_game_standings')
      .select('game_id, player_id, matches_played, total_points, placement_sum, game_rank')
      .eq('event_id', seed.eventId)
      .eq('category_id', seed.categoryId)
      .order('game_id', { ascending: true })
      .order('game_rank', { ascending: true });
    await assertNoError(error, 'select board_game_standings');

    expect(data).toHaveLength(8);
    const byGame = new Map<string, Array<Record<string, unknown>>>();
    for (const row of data ?? []) {
      const current = byGame.get(String(row.game_id)) ?? [];
      current.push(row as Record<string, unknown>);
      byGame.set(String(row.game_id), current);
    }

    const ascRows = byGame.get(seed.gameAscId) ?? [];
    const descRows = byGame.get(seed.gameDescId) ?? [];
    expect(ascRows.map((row) => row.player_id)).toEqual([
      seed.playerIds[0],
      seed.playerIds[1],
      seed.playerIds[3],
      seed.playerIds[2],
    ]);
    expect(descRows.map((row) => row.player_id)).toEqual([
      seed.playerIds[1],
      seed.playerIds[2],
      seed.playerIds[0],
      seed.playerIds[3],
    ]);

    const p1Asc = ascRows.find((row) => row.player_id === seed.playerIds[0]);
    const p4Desc = descRows.find((row) => row.player_id === seed.playerIds[3]);
    expect(asNumber(p1Asc?.matches_played as number)).toBe(2);
    expect(asNumber(p1Asc?.total_points as number)).toBe(30);
    expect(asNumber(p1Asc?.placement_sum as number)).toBe(3);
    expect(asNumber(p4Desc?.total_points as number)).toBe(13);
    expect(asNumber(p4Desc?.placement_sum as number)).toBe(8);
  });

  it('board_overall_standings computes category totals and rank', async () => {
    const { data, error } = await supabaseAdmin
      .from('board_overall_standings')
      .select('player_id, games_counted, overall_score, overall_rank')
      .eq('event_id', seed.eventId)
      .eq('category_id', seed.categoryId)
      .order('overall_rank', { ascending: true });
    await assertNoError(error, 'select board_overall_standings');

    expect(data).toHaveLength(4);
    expect((data ?? []).map((row) => row.player_id)).toEqual([
      seed.playerIds[1],
      seed.playerIds[0],
      seed.playerIds[2],
      seed.playerIds[3],
    ]);

    const top = data?.[0];
    const second = data?.[1];
    expect(asNumber(top?.games_counted)).toBe(2);
    expect(asNumber(top?.overall_score)).toBe(3);
    expect(asNumber(top?.overall_rank)).toBe(1);
    expect(asNumber(second?.overall_score)).toBe(4);
  });
});
