function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    const sorted: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      sorted[key] = sortObject(val);
    }
    return sorted;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  const sorted = sortObject(value);
  return JSON.stringify(sorted);
}
