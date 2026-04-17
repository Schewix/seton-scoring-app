import { describe, expect, it } from 'vitest';
import { buildRankTieSizeMap, formatTieBadge, formatTieExportValue } from '../scoreboard/tieUtils';

describe('scoreboard tie helpers', () => {
  it('formats tie badge text only for valid final ties', () => {
    expect(formatTieBadge(0)).toBe('');
    expect(formatTieBadge(1)).toBe('');
    expect(formatTieBadge(Number.NaN)).toBe('');
    expect(formatTieBadge(2)).toBe('Shoda po kritériích 1-5 (2 hlídky)');
    expect(formatTieBadge(5)).toBe('Shoda po kritériích 1-5 (5 hlídek)');
  });

  it('formats tie export value only when patrol remains tied in final ranking', () => {
    expect(formatTieExportValue(true, 1, 2)).toBe('');
    expect(formatTieExportValue(false, 0, 2)).toBe('');
    expect(formatTieExportValue(false, 1, 1)).toBe('');
    expect(formatTieExportValue(false, 1, 2)).toBe('ANO (shoda o 1. místo; 2 hlídky)');
    expect(formatTieExportValue(false, 3, 5)).toBe('ANO (shoda o 3. místo; 5 hlídek)');
  });

  it('builds rank tie-size map from rankable rows and ignores invalid ones', () => {
    const tieMap = buildRankTieSizeMap([
      { disqualified: false, rankInBracket: 1, totalPoints: 42, pointsNoT: 34 },
      { disqualified: false, rankInBracket: 1, totalPoints: 42, pointsNoT: 34 },
      { disqualified: false, rankInBracket: 3, totalPoints: 38, pointsNoT: 30 },
      { disqualified: true, rankInBracket: 3, totalPoints: 38, pointsNoT: 30 },
      { disqualified: false, rankInBracket: 4, totalPoints: null, pointsNoT: null },
      { disqualified: false, rankInBracket: 0, totalPoints: 30, pointsNoT: 22 },
    ]);

    expect(tieMap.get(1)).toBe(2);
    expect(tieMap.get(3)).toBe(1);
    expect(tieMap.has(4)).toBe(false);
    expect(tieMap.has(0)).toBe(false);
  });
});
