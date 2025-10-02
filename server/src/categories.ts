export const ALL_CATEGORIES = ['N', 'M', 'S', 'R'] as const;

export type CategoryKey = (typeof ALL_CATEGORIES)[number];

export const DEFAULT_ALLOWED_CATEGORIES: Record<string, readonly CategoryKey[]> = {
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
} as const;

export function isCategoryKey(value: string): value is CategoryKey {
  return (ALL_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCategory(value: string | null | undefined): CategoryKey | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return isCategoryKey(normalized) ? normalized : null;
}

export function normalizeAllowedCategories(
  raw: unknown,
  stationCode: string | null | undefined,
): CategoryKey[] {
  const values = Array.isArray(raw) ? raw : [];
  const normalized = values
    .map((value) => (typeof value === 'string' ? normalizeCategory(value) : null))
    .filter((value): value is CategoryKey => value !== null);

  if (normalized.length > 0) {
    const unique = Array.from(new Set(normalized));
    unique.sort();
    return unique;
  }

  const fallbackKey = stationCode?.trim().toUpperCase() ?? '';
  const fallback = fallbackKey ? DEFAULT_ALLOWED_CATEGORIES[fallbackKey] : undefined;
  if (fallback && fallback.length > 0) {
    return [...fallback];
  }

  return [...ALL_CATEGORIES];
}
