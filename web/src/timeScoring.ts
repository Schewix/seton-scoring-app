export type TimeScoringCategory = 'N' | 'M' | 'S' | 'R';

const CATEGORY_TIME_LIMITS_MINUTES: Record<TimeScoringCategory, number> = {
  N: 110,
  M: 120,
  S: 130,
  R: 140,
};

const CATEGORY_KEYS: readonly TimeScoringCategory[] = ['N', 'M', 'S', 'R'] as const;

export function isTimeScoringCategory(value: string | null | undefined): value is TimeScoringCategory {
  if (!value) {
    return false;
  }
  return CATEGORY_KEYS.includes(value as TimeScoringCategory);
}

export function computePureCourseSeconds({
  start,
  finish,
  waitMinutes = 0,
}: {
  start: Date;
  finish: Date;
  waitMinutes?: number;
}): number {
  let ms = finish.getTime() - start.getTime();
  if (!Number.isFinite(ms)) {
    return 0;
  }
  if (ms < 0) {
    ms += 24 * 60 * 60 * 1000;
  }
  const waitMs = Number.isFinite(waitMinutes) ? Math.max(0, waitMinutes) * 60 * 1000 : 0;
  const pureMs = Math.max(0, ms - waitMs);
  return Math.round(pureMs / 1000);
}

export function computeTimePoints(
  category: string | null | undefined,
  pureSeconds: number | null | undefined,
): number | null {
  const normalized = typeof category === 'string' ? category.trim().toUpperCase() : '';
  if (!isTimeScoringCategory(normalized) || pureSeconds === null || pureSeconds === undefined) {
    return null;
  }
  if (!Number.isFinite(pureSeconds)) {
    return null;
  }
  const safeSeconds = Math.max(0, Number(pureSeconds));
  const limitMinutes = CATEGORY_TIME_LIMITS_MINUTES[normalized];
  const limitSeconds = limitMinutes * 60;
  const overSeconds = safeSeconds - limitSeconds;
  if (overSeconds <= 0) {
    return 12;
  }
  const penaltySteps = Math.ceil(overSeconds / (10 * 60));
  return 12 - penaltySteps;
}
