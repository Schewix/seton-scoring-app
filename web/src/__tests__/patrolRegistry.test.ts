import { describe, expect, it } from 'vitest';
import {
  fetchPatrolRegistryEntries,
  getPatrolRegistryErrorMessage,
  mapPatrolRegistryRows,
} from '../data/patrolRegistry';

const isCategoryAllowed = () => true;

describe('fetchPatrolRegistryEntries', () => {
  it('returns cached entries when offline', async () => {
    const cached = [{ id: 'cached-1', code: 'NH-01', category: 'N', gender: 'H', number: '1', active: true }];

    const result = await fetchPatrolRegistryEntries({
      online: false,
      cachedEntries: cached,
      fetchRows: async () => ({ data: null, error: null }),
      isCategoryAllowed,
    });

    expect(result.entries).toEqual(cached);
    expect(result.error).toBeNull();
    expect(result.fetched).toBe(false);
  });

  it('keeps cached entries when online fetch fails', async () => {
    const cached = [{ id: 'cached-2', code: 'ND-02', category: 'N', gender: 'D', number: '2', active: true }];

    const result = await fetchPatrolRegistryEntries({
      online: true,
      cachedEntries: cached,
      fetchRows: async () => ({ data: null, error: new Error('offline') }),
      isCategoryAllowed,
    });

    expect(result.entries).toEqual(cached);
    expect(result.error).toBeNull();
    expect(result.fetched).toBe(false);
  });

  it('returns error when offline without cache', async () => {
    const result = await fetchPatrolRegistryEntries({
      online: false,
      cachedEntries: null,
      fetchRows: async () => ({ data: null, error: null }),
      isCategoryAllowed,
    });

    expect(result.entries).toBeNull();
    expect(result.error).toBe(getPatrolRegistryErrorMessage());
    expect(result.fetched).toBe(false);
  });
});

describe('mapPatrolRegistryRows', () => {
  it('maps registry rows to entries', () => {
    const { entries, stats } = mapPatrolRegistryRows(
      [{ id: 'row-1', patrol_code: 'NH-01', category: 'N', sex: 'H', active: true }],
      isCategoryAllowed,
    );

    expect(entries).toEqual([
      { id: 'row-1', code: 'NH-1', category: 'N', gender: 'H', number: '1', active: true },
    ]);
    expect(stats).toEqual({
      total: 1,
      inactive: 0,
      inactiveRatio: 0,
      breakdown: [{ category: 'N', gender: 'H', total: 1, inactive: 0, inactiveRatio: 0 }],
    });
  });
});
