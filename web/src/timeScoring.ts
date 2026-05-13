export type TimeScoringCategory = 'N' | 'M' | 'S' | 'R';

export type TimeScoringConfig = {
  limitMinutesByCategory: Record<TimeScoringCategory, number>;
  penaltyStepMinutes: number;
};

type TimeScoringConfigSource = {
  timeScoring?: {
    limitMinutesByCategory?: Partial<Record<TimeScoringCategory, unknown>>;
    penaltyStepMinutes?: unknown;
  } | null;
  time_limit_n_minutes?: unknown;
  time_limit_m_minutes?: unknown;
  time_limit_s_minutes?: unknown;
  time_limit_r_minutes?: unknown;
  time_penalty_step_minutes?: unknown;
} | null | undefined;

const CATEGORY_KEYS: readonly TimeScoringCategory[] = ['N', 'M', 'S', 'R'] as const;

const DEFAULT_TIME_LIMITS_MINUTES: Record<TimeScoringCategory, number> = {
  N: 110,
  M: 140,
  S: 140,
  R: 140,
};

const DEFAULT_PENALTY_STEP_MINUTES = 20;

export const DEFAULT_TIME_SCORING_CONFIG: TimeScoringConfig = {
  limitMinutesByCategory: { ...DEFAULT_TIME_LIMITS_MINUTES },
  penaltyStepMinutes: DEFAULT_PENALTY_STEP_MINUTES,
};

function toPositiveInt(value: unknown, fallback: number, max = 24 * 60): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(1, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(1, parsed));
    }
  }
  return fallback;
}

export function isTimeScoringCategory(value: string | null | undefined): value is TimeScoringCategory {
  if (!value) {
    return false;
  }
  return CATEGORY_KEYS.includes(value as TimeScoringCategory);
}

export function buildTimeScoringConfig(source: TimeScoringConfigSource): TimeScoringConfig {
  const nestedScoring = source?.timeScoring && typeof source.timeScoring === 'object' ? source.timeScoring : null;
  const nestedLimits =
    nestedScoring?.limitMinutesByCategory && typeof nestedScoring.limitMinutesByCategory === 'object'
      ? nestedScoring.limitMinutesByCategory
      : {};

  return {
    limitMinutesByCategory: {
      N: toPositiveInt(nestedLimits.N ?? source?.time_limit_n_minutes, DEFAULT_TIME_LIMITS_MINUTES.N),
      M: toPositiveInt(nestedLimits.M ?? source?.time_limit_m_minutes, DEFAULT_TIME_LIMITS_MINUTES.M),
      S: toPositiveInt(nestedLimits.S ?? source?.time_limit_s_minutes, DEFAULT_TIME_LIMITS_MINUTES.S),
      R: toPositiveInt(nestedLimits.R ?? source?.time_limit_r_minutes, DEFAULT_TIME_LIMITS_MINUTES.R),
    },
    penaltyStepMinutes: toPositiveInt(
      nestedScoring?.penaltyStepMinutes ?? source?.time_penalty_step_minutes,
      DEFAULT_PENALTY_STEP_MINUTES,
    ),
  };
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
  config: TimeScoringConfig = DEFAULT_TIME_SCORING_CONFIG,
): number | null {
  const normalized = typeof category === 'string' ? category.trim().toUpperCase() : '';
  if (!isTimeScoringCategory(normalized) || pureSeconds === null || pureSeconds === undefined) {
    return null;
  }
  if (!Number.isFinite(pureSeconds)) {
    return null;
  }

  const safeSeconds = Math.max(0, Number(pureSeconds));
  const limitMinutes = toPositiveInt(
    config.limitMinutesByCategory?.[normalized],
    DEFAULT_TIME_LIMITS_MINUTES[normalized],
  );
  const penaltyStepMinutes = toPositiveInt(config.penaltyStepMinutes, DEFAULT_PENALTY_STEP_MINUTES);
  const limitSeconds = limitMinutes * 60;
  const overSeconds = safeSeconds - limitSeconds;

  if (overSeconds <= 0) {
    return 12;
  }

  const penaltySteps = Math.ceil(overSeconds / (penaltyStepMinutes * 60));
  return Math.max(-12, 12 - penaltySteps);
}
