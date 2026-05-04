export type AfterpartyDrinkItem = {
  key: string;
  label: string;
  category: string;
  points: number;
};

export const AFTERPARTY_POINTS_PER_ITEM = 5;

export const AFTERPARTY_DRINK_MENU = [
  { category: 'Pivo', items: ['Radegast', 'Polička', 'Poutník'] },
  { category: 'Panáky', items: ['Zelená', 'Vodka', 'Rum'] },
  { category: 'Víno', items: ['Bílé', 'Červené'] },
  { category: 'Drinky', items: ['GT', 'Cuba Libre', 'Skinny Bitch'] },
  { category: 'Nealko', items: ['Voda', 'Kofola', 'Džus'] },
] as const;

export const AFTERPARTY_DRINK_ITEMS: AfterpartyDrinkItem[] = (() => {
  const seen = new Map<string, number>();
  return AFTERPARTY_DRINK_MENU.flatMap((section) =>
    section.items.map((label) => {
      const normalized = label
        .trim()
        .toLocaleLowerCase('cs')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const base = normalized || 'drink';
      const duplicateCount = (seen.get(base) ?? 0) + 1;
      seen.set(base, duplicateCount);
      const suffix = duplicateCount > 1 ? `-${duplicateCount}` : '';
      return {
        key: `drink-${base}${suffix}`,
        label,
        category: section.category,
        points: AFTERPARTY_POINTS_PER_ITEM,
      };
    }),
  );
})();

export const AFTERPARTY_DRINK_BY_KEY = new Map(AFTERPARTY_DRINK_ITEMS.map((item) => [item.key, item]));

export function createEmptyAfterpartyCounts() {
  return AFTERPARTY_DRINK_ITEMS.reduce<Record<string, number>>((acc, item) => {
    acc[item.key] = 0;
    return acc;
  }, {});
}

export function calculateAfterpartyPoints(counts: Record<string, number>) {
  return AFTERPARTY_DRINK_ITEMS.reduce((sum, item) => sum + Math.max(0, counts[item.key] ?? 0) * item.points, 0);
}
