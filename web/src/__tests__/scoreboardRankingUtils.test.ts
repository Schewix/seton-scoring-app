import { describe, expect, it } from 'vitest';
import {
  assignDisplayRanks,
  compareRankedResults,
  hasRecordedScore,
  type RankableScoreItem,
} from '../scoreboard/rankingUtils';

function row(overrides: Partial<RankableScoreItem>): RankableScoreItem {
  return {
    rankInBracket: 1,
    totalPoints: null,
    pointsNoT: 0,
    pureSeconds: null,
    teamName: 'Hlídka',
    ...overrides,
  };
}

describe('scoreboard ranking helpers', () => {
  it('distinguishes an unscored patrol from a recorded zero-point score', () => {
    expect(hasRecordedScore(row({ totalPoints: null, pointsNoT: 0 }))).toBe(false);
    expect(hasRecordedScore(row({ totalPoints: 0, pointsNoT: 0 }))).toBe(true);
  });

  it('sorts every scored patrol before patrols without a score record', () => {
    const items = [
      row({ teamName: 'Bez bodů A', rankInBracket: 1 }),
      row({ teamName: 'Tři body', rankInBracket: 4, totalPoints: 3, pointsNoT: 3 }),
      row({ teamName: 'Nula bodů', rankInBracket: 5, totalPoints: 0, pointsNoT: 0 }),
      row({ teamName: 'Bez bodů B', rankInBracket: 1 }),
    ].sort(compareRankedResults);

    expect(items.map((item) => item.teamName)).toEqual([
      'Tři body',
      'Nula bodů',
      'Bez bodů A',
      'Bez bodů B',
    ]);
  });

  it('rebases database ranks while preserving genuine ties', () => {
    const items = [
      row({ teamName: 'Shoda A', rankInBracket: 4, totalPoints: 3, pointsNoT: 3 }),
      row({ teamName: 'Shoda B', rankInBracket: 4, totalPoints: 3, pointsNoT: 3 }),
      row({ teamName: 'Další', rankInBracket: 6, totalPoints: 1, pointsNoT: 1 }),
      row({ teamName: 'Bez bodů', rankInBracket: 1 }),
    ];

    const ranked = assignDisplayRanks(items);
    expect(ranked.map((item) => item.displayRank)).toEqual([1, 1, 3, 4]);
    expect(ranked.map((item) => item.orderInBracket)).toEqual([1, 2, 3, 4]);
  });
});
