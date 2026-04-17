export type TieRankedItem = {
  disqualified: boolean;
  rankInBracket: number;
  totalPoints: number | null;
  pointsNoT: number | null;
};

function hasAnyPoints(item: TieRankedItem) {
  return item.totalPoints !== null || item.pointsNoT !== null;
}

function formatTieCount(tieSize: number) {
  if (tieSize === 1) {
    return '1 hlídka';
  }
  if (tieSize >= 2 && tieSize <= 4) {
    return `${tieSize} hlídky`;
  }
  return `${tieSize} hlídek`;
}

export function formatTieBadge(tieSize: number) {
  if (!Number.isFinite(tieSize) || tieSize <= 1) {
    return '';
  }
  return `Shoda po kritériích 1-5 (${formatTieCount(tieSize)})`;
}

export function formatTieExportValue(isDisqualified: boolean, rank: number, tieSize: number) {
  if (isDisqualified || tieSize <= 1 || !Number.isFinite(rank) || rank <= 0) {
    return '';
  }
  return `ANO (shoda o ${rank}. místo; ${formatTieCount(tieSize)})`;
}

export function buildRankTieSizeMap(items: readonly TieRankedItem[]) {
  const tieSizeByRank = new Map<number, number>();
  items.forEach((item) => {
    const rank = item.rankInBracket;
    if (item.disqualified || !hasAnyPoints(item) || !Number.isFinite(rank) || rank <= 0) {
      return;
    }
    tieSizeByRank.set(rank, (tieSizeByRank.get(rank) ?? 0) + 1);
  });
  return tieSizeByRank;
}
