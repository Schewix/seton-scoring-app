export type RankableScoreItem = {
  rankInBracket: number;
  totalPoints: number | null;
  pointsNoT: number | null;
  pureSeconds: number | null;
  teamName: string;
};

export function hasRecordedScore(item: Pick<RankableScoreItem, 'totalPoints'>) {
  return item.totalPoints !== null;
}

export function compareRankedResults(a: RankableScoreItem, b: RankableScoreItem) {
  const aHasScore = hasRecordedScore(a);
  const bHasScore = hasRecordedScore(b);

  if (aHasScore !== bHasScore) {
    return aHasScore ? -1 : 1;
  }

  const aRank = a.rankInBracket > 0 ? a.rankInBracket : Number.POSITIVE_INFINITY;
  const bRank = b.rankInBracket > 0 ? b.rankInBracket : Number.POSITIVE_INFINITY;
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  const aPoints = a.totalPoints ?? Number.NEGATIVE_INFINITY;
  const bPoints = b.totalPoints ?? Number.NEGATIVE_INFINITY;
  if (aPoints !== bPoints) {
    return bPoints - aPoints;
  }

  const aPointsNoT = a.pointsNoT ?? Number.NEGATIVE_INFINITY;
  const bPointsNoT = b.pointsNoT ?? Number.NEGATIVE_INFINITY;
  if (aPointsNoT !== bPointsNoT) {
    return bPointsNoT - aPointsNoT;
  }

  const aTime = a.pureSeconds ?? Number.POSITIVE_INFINITY;
  const bTime = b.pureSeconds ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a.teamName.localeCompare(b.teamName, 'cs');
}

export function assignDisplayRanks<T extends RankableScoreItem>(items: readonly T[]) {
  let scoredPosition = 0;
  let previousSourceRank: number | null = null;
  let previousDisplayRank = 0;

  return items.map((item, index) => {
    const orderInBracket = index + 1;
    if (!hasRecordedScore(item)) {
      return { ...item, displayRank: orderInBracket, orderInBracket };
    }

    scoredPosition += 1;
    const sourceRank = Number.isFinite(item.rankInBracket) && item.rankInBracket > 0
      ? item.rankInBracket
      : null;
    const displayRank = sourceRank !== null && sourceRank === previousSourceRank
      ? previousDisplayRank
      : scoredPosition;

    previousSourceRank = sourceRank;
    previousDisplayRank = displayRank;
    return { ...item, displayRank, orderInBracket };
  });
}
