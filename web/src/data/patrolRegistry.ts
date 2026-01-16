import localforage from 'localforage';
import type { PatrolRegistryEntry } from '../components/PatrolCodeInput';
import { normalisePatrolCode } from '../components/PatrolCodeInput';

const REGISTRY_CACHE_KEY_PREFIX = 'patrol_registry_v1';
const REGISTRY_ERROR_MESSAGE = 'Nepodařilo se načíst dostupná čísla hlídek.';

export type PatrolRegistryFetchResponse = {
  data: RawRegistryRow[] | null;
  error: unknown | null;
};

export type PatrolRegistryLoadResult = {
  entries: PatrolRegistryEntry[] | null;
  error: string | null;
  stats: PatrolRegistryLoadStats | null;
  fetched: boolean;
};

export type PatrolRegistryLoadStats = {
  total: number;
  inactive: number;
  inactiveRatio: number;
  breakdown: {
    category: string;
    gender: string;
    total: number;
    inactive: number;
    inactiveRatio: number;
  }[];
};

export type RawRegistryRow = {
  id: string;
  patrol_code: string | null;
  category: string | null;
  sex: string | null;
  active: boolean | null;
};

type PatrolRegistryCache = {
  entries: PatrolRegistryEntry[];
  updatedAt: number;
};

function getRegistryCacheKey(eventId: string) {
  return `${REGISTRY_CACHE_KEY_PREFIX}:${eventId}`;
}

export async function loadPatrolRegistryCache(eventId: string) {
  return localforage.getItem<PatrolRegistryCache | null>(getRegistryCacheKey(eventId));
}

export async function savePatrolRegistryCache(eventId: string, entries: PatrolRegistryEntry[]) {
  const payload: PatrolRegistryCache = {
    entries,
    updatedAt: Date.now(),
  };
  return localforage.setItem(getRegistryCacheKey(eventId), payload);
}

export function mapPatrolRegistryRows(
  rows: RawRegistryRow[],
  isCategoryAllowed: (category: string) => boolean,
) {
  const entries: PatrolRegistryEntry[] = [];
  const availabilityStats = new Map<string, { total: number; inactive: number }>();
  let totalInactive = 0;

  rows.forEach((row) => {
    const normalized = normalisePatrolCode(row.patrol_code ?? '');
    const match = normalized.match(/^([NMSR])([HD])-(\d{1,2})$/);
    if (!match) {
      return;
    }
    const [, category, gender, digits] = match;
    if (!isCategoryAllowed(category)) {
      return;
    }
    const numeric = Number.parseInt(digits, 10);
    if (!Number.isFinite(numeric)) {
      return;
    }
    const statsKey = `${category}-${gender}`;
    const stats = availabilityStats.get(statsKey) ?? { total: 0, inactive: 0 };
    stats.total += 1;
    const isActive = row.active !== false;
    if (!isActive) {
      stats.inactive += 1;
      totalInactive += 1;
    }
    availabilityStats.set(statsKey, stats);
    entries.push({
      id: row.id,
      code: normalized,
      category,
      gender,
      number: String(numeric),
      active: isActive,
    });
  });

  const breakdown = Array.from(availabilityStats.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, stats]) => {
      const [category, gender] = group.split('-');
      const groupRatio = stats.total > 0 ? stats.inactive / stats.total : 0;
      return {
        category,
        gender,
        total: stats.total,
        inactive: stats.inactive,
        inactiveRatio: Number(groupRatio.toFixed(3)),
      };
    });

  const ratio = entries.length > 0 ? totalInactive / entries.length : 0;
  return {
    entries,
    stats: {
      total: entries.length,
      inactive: totalInactive,
      inactiveRatio: Number(ratio.toFixed(3)),
      breakdown,
    },
  };
}

export async function fetchPatrolRegistryEntries({
  online,
  cachedEntries,
  fetchRows,
  isCategoryAllowed,
}: {
  online: boolean;
  cachedEntries: PatrolRegistryEntry[] | null;
  fetchRows: () => Promise<PatrolRegistryFetchResponse>;
  isCategoryAllowed: (category: string) => boolean;
}): Promise<PatrolRegistryLoadResult> {
  if (!online) {
    return {
      entries: cachedEntries,
      error: cachedEntries ? null : REGISTRY_ERROR_MESSAGE,
      stats: null,
      fetched: false,
    };
  }

  const { data, error } = await fetchRows();
  if (error) {
    return {
      entries: cachedEntries,
      error: cachedEntries ? null : REGISTRY_ERROR_MESSAGE,
      stats: null,
      fetched: false,
    };
  }

  const { entries, stats } = mapPatrolRegistryRows((data ?? []) as RawRegistryRow[], isCategoryAllowed);
  return {
    entries,
    error: null,
    stats,
    fetched: true,
  };
}

export function getPatrolRegistryErrorMessage() {
  return REGISTRY_ERROR_MESSAGE;
}
