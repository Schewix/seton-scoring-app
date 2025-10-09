import { CategoryKey, isCategoryKey } from './targetAnswers';

export const STATION_PASSAGE_CATEGORIES = ['NH', 'ND', 'MH', 'MD', 'SH', 'SD', 'RH', 'RD'] as const;

export type StationCategoryKey = (typeof STATION_PASSAGE_CATEGORIES)[number];

export const STATION_ALLOWED_BASE_CATEGORIES: Record<string, CategoryKey[]> = {
  A: ['M', 'S', 'R'],
  B: ['N', 'M', 'S', 'R'],
  C: ['N', 'M', 'S', 'R'],
  D: ['R'],
  F: ['N', 'M', 'S', 'R'],
  J: ['N', 'M', 'S', 'R'],
  K: ['N', 'M'],
  M: ['M', 'S', 'R'],
  N: ['S', 'R'],
  O: ['N', 'M', 'S', 'R'],
  P: ['N', 'M', 'S', 'R'],
  S: ['M', 'S', 'R'],
  T: ['N', 'M', 'S', 'R'],
  U: ['N', 'M', 'S', 'R'],
  V: ['S', 'R'],
  Z: ['N', 'M', 'S', 'R'],
};

export function getStationAllowedBaseCategories(stationCode: string): CategoryKey[] {
  const normalized = stationCode.trim().toUpperCase();
  return STATION_ALLOWED_BASE_CATEGORIES[normalized] ?? ['N', 'M', 'S', 'R'];
}

function toStationCategorySet(baseCategories: Iterable<string | CategoryKey>): Set<StationCategoryKey> {
  const allowed = new Set<StationCategoryKey>();
  for (const base of baseCategories) {
    const normalized = typeof base === 'string' ? base.trim().toUpperCase() : base;
    if (!isCategoryKey(normalized)) {
      continue;
    }
    if (normalized === 'N') {
      allowed.add('NH');
      allowed.add('ND');
    }
    if (normalized === 'M') {
      allowed.add('MH');
      allowed.add('MD');
    }
    if (normalized === 'S') {
      allowed.add('SH');
      allowed.add('SD');
    }
    if (normalized === 'R') {
      allowed.add('RH');
      allowed.add('RD');
    }
  }
  return allowed;
}

export function getAllowedStationCategories(
  stationCode: string,
  options?: { baseCategories?: Iterable<string | CategoryKey> | null },
): StationCategoryKey[] {
  const baseCategories = options?.baseCategories ?? getStationAllowedBaseCategories(stationCode);
  const allowed = toStationCategorySet(baseCategories);
  return STATION_PASSAGE_CATEGORIES.filter((category) => allowed.has(category));
}

export function toStationCategoryKey(
  category: string | null | undefined,
  sex: string | null | undefined,
): StationCategoryKey | null {
  const normalizedCategory = category?.trim().toUpperCase() ?? '';
  const normalizedSex = sex?.trim().toUpperCase() ?? '';

  if (!isCategoryKey(normalizedCategory)) {
    return null;
  }
  if (normalizedSex === 'H') {
    if (normalizedCategory === 'N') return 'NH';
    if (normalizedCategory === 'M') return 'MH';
    if (normalizedCategory === 'S') return 'SH';
    if (normalizedCategory === 'R') return 'RH';
  }
  if (normalizedSex === 'D') {
    if (normalizedCategory === 'N') return 'ND';
    if (normalizedCategory === 'M') return 'MD';
    if (normalizedCategory === 'S') return 'SD';
    if (normalizedCategory === 'R') return 'RD';
  }
  return null;
}

export function createStationCategoryRecord<T>(factory: () => T): Record<StationCategoryKey, T> {
  const record = {} as Record<StationCategoryKey, T>;
  STATION_PASSAGE_CATEGORIES.forEach((category) => {
    record[category] = factory();
  });
  return record;
}
