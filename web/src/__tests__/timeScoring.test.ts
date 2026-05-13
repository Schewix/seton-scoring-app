import { describe, it, expect } from 'vitest';
import { buildTimeScoringConfig, computePureCourseSeconds, computeTimePoints, isTimeScoringCategory } from '../timeScoring';

describe('timeScoring', () => {
  it('identifies valid categories', () => {
    expect(isTimeScoringCategory('N')).toBe(true);
    expect(isTimeScoringCategory('m')).toBe(false);
    expect(isTimeScoringCategory(' X ')).toBe(false);
    expect(isTimeScoringCategory(undefined)).toBe(false);
  });

  it('computes pure course seconds with midnight rollover and wait', () => {
    const start = new Date('2024-06-01T21:30:00Z');
    const finish = new Date('2024-06-02T00:05:30Z');
    const result = computePureCourseSeconds({ start, finish, waitMinutes: 15 });
    expect(result).toBe(8430);
  });

  it('returns 12 points at or under category limit', () => {
    expect(computeTimePoints('N', 110 * 60)).toBe(12);
    expect(computeTimePoints('N', 90 * 60)).toBe(12);
    expect(computeTimePoints('n', 100 * 60)).toBe(12);
  });

  it('applies one point penalty for each started 20 minutes over limit', () => {
    expect(computeTimePoints('M', 141 * 60)).toBe(11);
    expect(computeTimePoints('M', 159 * 60)).toBe(11);
    expect(computeTimePoints('M', 160 * 60)).toBe(11);
    expect(computeTimePoints('M', 161 * 60)).toBe(10);
  });

  it('matches the race time table for category M', () => {
    expect(computeTimePoints('M', (3 * 60 + 57) * 60)).toBe(7);
  });

  it('never goes below -12 points', () => {
    expect(computeTimePoints('M', 1000 * 60)).toBe(-12);
  });

  it('returns null for unsupported categories or missing time', () => {
    expect(computeTimePoints('X', 1000)).toBeNull();
    expect(computeTimePoints('N', null)).toBeNull();
  });

  it('builds scoring config from manifest or flat event settings', () => {
    const fromManifest = buildTimeScoringConfig({
      timeScoring: {
        limitMinutesByCategory: { N: 100, M: 120 },
        penaltyStepMinutes: 15,
      },
    });
    expect(fromManifest.limitMinutesByCategory.N).toBe(100);
    expect(fromManifest.limitMinutesByCategory.M).toBe(120);
    expect(fromManifest.limitMinutesByCategory.S).toBe(140);
    expect(fromManifest.penaltyStepMinutes).toBe(15);

    const fromFlat = buildTimeScoringConfig({
      time_limit_n_minutes: 105,
      time_limit_m_minutes: 130,
      time_penalty_step_minutes: 18,
    });
    expect(fromFlat.limitMinutesByCategory.N).toBe(105);
    expect(fromFlat.limitMinutesByCategory.M).toBe(130);
    expect(fromFlat.penaltyStepMinutes).toBe(18);
  });
});
