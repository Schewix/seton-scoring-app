import { describe, it, expect } from 'vitest';
import { computePureCourseSeconds, computeTimePoints, isTimeScoringCategory } from '../timeScoring';

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

  it('applies one point penalty for each started 10 minutes over limit', () => {
    expect(computeTimePoints('M', 121 * 60)).toBe(11);
    expect(computeTimePoints('M', 129 * 60)).toBe(11);
    expect(computeTimePoints('M', 130 * 60)).toBe(11);
    expect(computeTimePoints('M', 131 * 60)).toBe(10);
  });

  it('returns null for unsupported categories or missing time', () => {
    expect(computeTimePoints('X', 1000)).toBeNull();
    expect(computeTimePoints('N', null)).toBeNull();
  });
});
