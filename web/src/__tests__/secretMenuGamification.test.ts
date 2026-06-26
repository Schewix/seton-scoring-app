import { describe, expect, it } from 'vitest';
import { MENU_ITEMS } from '../data/menuItems';
import {
  addConsumedItem,
  createEmptySecretMenuState,
  getCategoryProgress,
  getMenuCompletion,
  getProgressToNextLevel,
  getUnlockedAchievements,
  getUserLevel,
  getUserPoints,
  type SecretMenuState,
} from '../secretMenu/gamification';

function itemId(name: string) {
  const item = MENU_ITEMS.find((menuItem) => menuItem.name === name);
  if (!item) {
    throw new Error(`Missing test menu item: ${name}`);
  }
  return item.id;
}

function addMany(state: SecretMenuState, itemName: string, count: number) {
  let current = state;
  for (let index = 0; index < count; index += 1) {
    current = addConsumedItem(current, itemId(itemName), '2026-06-26T12:00:00.000Z');
  }
  return current;
}

describe('secret menu gamification', () => {
  it('adds base points and first-time item bonus only once per item', () => {
    let state = createEmptySecretMenuState();
    state = addConsumedItem(state, itemId('Radegast 12°'), '2026-06-26T12:00:00.000Z');
    expect(getUserPoints(state)).toBe(70);

    state = addConsumedItem(state, itemId('Radegast 12°'), '2026-06-26T13:00:00.000Z');
    expect(getUserPoints(state)).toBe(120);
  });

  it('unlocks category achievements when all required items are collected', () => {
    let state = createEmptySecretMenuState();
    state = addConsumedItem(state, itemId('Radegast 12°'));
    state = addConsumedItem(state, itemId('Poutník 12°'));
    state = addConsumedItem(state, itemId('Polička 11°'));

    expect(getUnlockedAchievements(state).map((achievement) => achievement.id)).toContain('beer-lover');
    expect(getUserPoints(state)).toBe(410);
  });

  it('supports a non-alcoholic progression path', () => {
    const state = addMany(createEmptySecretMenuState(), 'Klobásek', 38);

    expect(getUnlockedAchievements(state).map((achievement) => achievement.id)).toContain('sober-legend');
    expect(getUserLevel(state).name).toBe('Místní legenda');
  });

  it('tracks visit-day achievements from consumed item history', () => {
    let state = createEmptySecretMenuState();
    state = addConsumedItem(state, itemId('Cola'), '2026-06-01T12:00:00.000Z');
    state = addConsumedItem(state, itemId('Cola'), '2026-06-02T12:00:00.000Z');
    state = addConsumedItem(state, itemId('Cola'), '2026-06-03T12:00:00.000Z');

    expect(getUnlockedAchievements(state).map((achievement) => achievement.id)).toContain('regular');
  });

  it('reports level, category and menu completion progress', () => {
    let state = createEmptySecretMenuState();
    state = addConsumedItem(state, itemId('Espresso'));
    state = addConsumedItem(state, itemId('Cappuccino'));
    state = addConsumedItem(state, itemId('Latte Macchiato'));
    state = addConsumedItem(state, itemId('Tea 0.25'));

    expect(getUnlockedAchievements(state).map((achievement) => achievement.id)).toContain('caffeine-demon');
    expect(getProgressToNextLevel(state).currentLevel.name).toBe('Nováček');
    expect(getMenuCompletion(state).consumedItems).toBe(4);
    expect(getCategoryProgress(state).find((category) => category.category === 'coffee')?.consumedItems).toBe(3);
  });
});
