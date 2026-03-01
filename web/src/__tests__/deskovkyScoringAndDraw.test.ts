import { describe, expect, it } from 'vitest';
import {
  BOARD_DRAW_MAX_TABLES_PER_GAME,
  buildPlacementsFromPoints,
  buildRoundTableSizes,
  parseNumeric,
  planCategoryDraw,
  resolvePlacementForSave,
} from '../features/deskovky/DeskovkyApp';
import type { BoardBlock, BoardPlayer, BoardPointsOrder } from '../features/deskovky/types';

const GAME_POINTS_ORDER_CASES: Array<{ game: string; pointsOrder: BoardPointsOrder }> = [
  { game: 'Tajna vyprava carodeju', pointsOrder: 'asc' },
  { game: 'Dobble', pointsOrder: 'asc' },
  { game: 'Hop', pointsOrder: 'asc' },
  { game: 'Ubongo', pointsOrder: 'desc' },
  { game: 'Kris kros', pointsOrder: 'desc' },
  { game: 'Dominion', pointsOrder: 'desc' },
];

function buildPlayer(index: number, teamNumber = (index % 8) + 1): BoardPlayer {
  return {
    id: `player-${index}`,
    event_id: 'event-1',
    short_code: `P${String(index + 1).padStart(2, '0')}`,
    team_name: `${teamNumber}. PTO Test`,
    display_name: `Hrac ${index + 1}`,
    category_id: 'cat-1',
    disqualified: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function buildBlock(blockNumber: number): BoardBlock {
  return {
    id: `block-${blockNumber}`,
    event_id: 'event-1',
    category_id: 'cat-1',
    block_number: blockNumber,
    game_id: `game-${blockNumber}`,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function buildEntries(points: number[]) {
  return points.map((value, index) => ({
    id: `entry-${index + 1}`,
    seat: index + 1,
    points: String(value),
  }));
}

describe('deskovky scoring + ranking helpers', () => {
  it('parseNumeric parses decimal comma and rejects invalid values', () => {
    expect(parseNumeric(' 3,5 ')).toBe(3.5);
    expect(parseNumeric('4.25')).toBe(4.25);
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('abc')).toBeNull();
  });

  it.each(GAME_POINTS_ORDER_CASES)('%s uses correct points direction for auto placement', ({ pointsOrder }) => {
    const placements = buildPlacementsFromPoints(
      buildEntries([10, 20, 30, 40]),
      pointsOrder,
    );

    if (pointsOrder === 'asc') {
      expect(placements.get('entry-1')).toBe(1);
      expect(placements.get('entry-4')).toBe(4);
    } else {
      expect(placements.get('entry-1')).toBe(4);
      expect(placements.get('entry-4')).toBe(1);
    }
  });

  it('uses averaged placement for ties and keeps sum of placements correct', () => {
    const placements = buildPlacementsFromPoints(
      buildEntries([40, 40, 20, 10]),
      'desc',
    );

    expect(placements.get('entry-1')).toBe(1.5);
    expect(placements.get('entry-2')).toBe(1.5);
    expect(placements.get('entry-3')).toBe(3);
    expect(placements.get('entry-4')).toBe(4);

    const placementSum = Array.from(placements.values()).reduce((sum, rank) => sum + rank, 0);
    expect(placementSum).toBe(10);
  });

  it('resolvePlacementForSave prefers manual placement and falls back to auto only when needed', () => {
    expect(
      resolvePlacementForSave({
        scoringType: 'both',
        parsedPoints: 42,
        parsedPlacement: 2,
        autoPlacement: 1,
      }),
    ).toBe(2);

    expect(
      resolvePlacementForSave({
        scoringType: 'both',
        parsedPoints: 42,
        parsedPlacement: null,
        autoPlacement: 1.5,
      }),
    ).toBe(1.5);

    expect(
      resolvePlacementForSave({
        scoringType: 'points',
        parsedPoints: 42,
        parsedPlacement: 3,
        autoPlacement: 3,
      }),
    ).toBeNull();

    expect(
      resolvePlacementForSave({
        scoringType: 'placement',
        parsedPoints: 42,
        parsedPlacement: 3,
        autoPlacement: 1,
      }),
    ).toBe(3);
  });
});

describe('deskovky draw planner invariants', () => {
  it('buildRoundTableSizes respects max 25 tables per game', () => {
    const sizes = buildRoundTableSizes(101);
    expect(sizes.length).toBe(BOARD_DRAW_MAX_TABLES_PER_GAME);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(4);
  });

  it('every active player appears exactly once per round and 3x per block', () => {
    const players = Array.from({ length: 16 }, (_, index) => buildPlayer(index));
    const plans = planCategoryDraw(players, [buildBlock(1)]);
    expect(plans).toHaveLength(1);
    expect(plans[0].rounds).toHaveLength(3);

    const appearances = new Map<string, number>();
    for (const round of plans[0].rounds) {
      const seenInRound = new Set<string>();
      for (const table of round.tables) {
        for (const playerId of table.playerIds) {
          expect(seenInRound.has(playerId)).toBe(false);
          seenInRound.add(playerId);
          appearances.set(playerId, (appearances.get(playerId) ?? 0) + 1);
        }
      }
      expect(seenInRound.size).toBe(players.length);
    }

    for (const player of players) {
      expect(appearances.get(player.id)).toBe(3);
    }
  });

  it('minimizes repeated opponents when full 4-player tables are feasible', () => {
    const players = Array.from({ length: 16 }, (_, index) => buildPlayer(index, index + 1));
    const plans = planCategoryDraw(players, [buildBlock(1)]);
    const pairCounts = new Map<string, number>();

    for (const round of plans[0].rounds) {
      for (const table of round.tables) {
        for (let i = 0; i < table.playerIds.length; i += 1) {
          for (let j = i + 1; j < table.playerIds.length; j += 1) {
            const key = [table.playerIds[i], table.playerIds[j]].sort().join('|');
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          }
        }
      }
    }

    expect(Math.max(...pairCounts.values())).toBeLessThanOrEqual(1);
  });

  it('flags relaxed same-team mode when strict oddil separation is impossible', () => {
    const players = Array.from({ length: 8 }, (_, index) => buildPlayer(index, 1));
    const plans = planCategoryDraw(players, [buildBlock(1)]);
    expect(plans[0].usedRelaxedSameTeamRule).toBe(true);
  });

  it('keeps 2-player teams apart and pushes unavoidable same-team pairs to larger teams', () => {
    const players = [
      ...Array.from({ length: 4 }, (_, index) => buildPlayer(index, 1)),
      ...Array.from({ length: 2 }, (_, index) => buildPlayer(index + 4, 2)),
      ...Array.from({ length: 2 }, (_, index) => buildPlayer(index + 6, 3)),
    ];

    const plans = planCategoryDraw(players, [buildBlock(1)]);
    const idToTeam = new Map(players.map((player) => [player.id, player.team_name]));
    const sameTeamByTeam = new Map<string, number>();

    for (const round of plans[0].rounds) {
      for (const table of round.tables) {
        for (let i = 0; i < table.playerIds.length; i += 1) {
          for (let j = i + 1; j < table.playerIds.length; j += 1) {
            const teamA = idToTeam.get(table.playerIds[i]);
            const teamB = idToTeam.get(table.playerIds[j]);
            if (!teamA || teamA !== teamB) {
              continue;
            }
            sameTeamByTeam.set(teamA, (sameTeamByTeam.get(teamA) ?? 0) + 1);
          }
        }
      }
    }

    expect(sameTeamByTeam.get('1. PTO Test') ?? 0).toBeGreaterThan(0);
    expect(sameTeamByTeam.get('2. PTO Test') ?? 0).toBe(0);
    expect(sameTeamByTeam.get('3. PTO Test') ?? 0).toBe(0);
  });

  it('keeps players out of two tables in the same round across repeated randomized runs', () => {
    const players = Array.from({ length: 22 }, (_, index) => buildPlayer(index, (index % 6) + 1));
    const blocks = [buildBlock(1), buildBlock(2)];

    for (let run = 0; run < 8; run += 1) {
      const plans = planCategoryDraw(players, blocks);
      for (const plan of plans) {
        for (const round of plan.rounds) {
          const seen = new Set<string>();
          for (const table of round.tables) {
            for (const playerId of table.playerIds) {
              expect(seen.has(playerId)).toBe(false);
              seen.add(playerId);
            }
          }
          expect(seen.size).toBe(players.length);
        }
      }
    }
  });
});
