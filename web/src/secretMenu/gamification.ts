import {
  MENU_CATEGORY_LABELS,
  MENU_CATEGORY_ORDER,
  MENU_ITEM_BY_ID,
  MENU_ITEMS,
  type MenuCategory,
  type MenuItem,
} from '../data/menuItems';

export const FIRST_TIME_ITEM_BONUS = 20;

export type ConsumedMenuItem = {
  id: string;
  itemId: string;
  consumedAt: string;
};

export type SecretMenuState = {
  consumedItems: ConsumedMenuItem[];
};

export type SecretMenuLevel = {
  id: string;
  name: string;
  minPoints: number;
};

export type LevelProgress = {
  points: number;
  currentLevel: SecretMenuLevel;
  nextLevel: SecretMenuLevel | null;
  pointsInCurrentLevel: number;
  pointsNeededForNextLevel: number;
  progressPercent: number;
};

export type CategoryProgress = {
  category: MenuCategory;
  label: string;
  totalItems: number;
  consumedItems: number;
  totalConsumed: number;
  points: number;
  completionPercent: number;
};

export type MenuCompletion = {
  totalItems: number;
  consumedItems: number;
  percent: number;
};

export type AchievementProgress = {
  id: string;
  title: string;
  description: string;
  bonusPoints: number;
  current: number;
  target: number;
  progressPercent: number;
  unlocked: boolean;
};

type AchievementContext = {
  entries: ConsumedMenuItem[];
  uniqueItemIds: Set<string>;
  visitDays: Set<string>;
  activityPoints: number;
  soberPoints: number;
};

type AchievementDefinition = {
  id: string;
  title: string;
  description: string;
  bonusPoints: number;
  getProgress: (context: AchievementContext) => { current: number; target: number };
};

export const SECRET_MENU_LEVELS: SecretMenuLevel[] = [
  { id: 'novacek', name: 'Nováček', minPoints: 0 },
  { id: 'stamgast', name: 'Štamgast', minPoints: 500 },
  { id: 'znama-tvar', name: 'Známá tvář', minPoints: 1500 },
  { id: 'mistni-legenda', name: 'Místní legenda', minPoints: 3000 },
  { id: 'patron-hospody', name: 'Patron hospody', minPoints: 6000 },
  { id: 'kral-tajneho-menu', name: 'Král tajného menu', minPoints: 10000 },
  { id: 'legenda-bezpravi', name: 'Legenda Bezpráví', minPoints: 15000 },
];

const SOBER_CATEGORIES = new Set<MenuCategory>(['soft-drinks', 'coffee', 'tea', 'food-snacks']);

function clampPercent(current: number, target: number) {
  if (target <= 0) {
    return 100;
  }
  return Math.min(100, Math.max(0, Math.round((current / target) * 1000) / 10));
}

function normalizeDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function normalizeConsumedAt(value: Date | string | number | undefined) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function getKnownEntries(state: SecretMenuState) {
  return state.consumedItems.filter((entry) => MENU_ITEM_BY_ID.has(entry.itemId));
}

function getUniqueItemIds(entries: ConsumedMenuItem[]) {
  return new Set(entries.map((entry) => entry.itemId).filter((itemId) => MENU_ITEM_BY_ID.has(itemId)));
}

function getItemsByCategory(category: MenuCategory) {
  return MENU_ITEMS.filter((menuItem) => menuItem.category === category);
}

function getItemIdsByCategory(category: MenuCategory) {
  return getItemsByCategory(category).map((menuItem) => menuItem.id);
}

function getItemIdsByTag(tag: string) {
  return MENU_ITEMS.filter((menuItem) => menuItem.tags.includes(tag)).map((menuItem) => menuItem.id);
}

function countConsumedTargets(uniqueItemIds: Set<string>, targetItemIds: string[]) {
  return targetItemIds.filter((itemId) => uniqueItemIds.has(itemId)).length;
}

function getActivityPoints(
  state: SecretMenuState,
  options: { categories?: Set<MenuCategory> } = {},
) {
  const entries = getKnownEntries(state);
  const firstSeen = new Set<string>();
  let points = 0;

  entries.forEach((entry) => {
    const menuItem = MENU_ITEM_BY_ID.get(entry.itemId);
    if (!menuItem || (options.categories && !options.categories.has(menuItem.category))) {
      return;
    }
    points += menuItem.points;
    if (!firstSeen.has(menuItem.id)) {
      firstSeen.add(menuItem.id);
      points += FIRST_TIME_ITEM_BONUS;
    }
  });

  return points;
}

function createContext(state: SecretMenuState): AchievementContext {
  const entries = getKnownEntries(state);
  const uniqueItemIds = getUniqueItemIds(entries);
  return {
    entries,
    uniqueItemIds,
    visitDays: new Set(entries.map((entry) => normalizeDateKey(entry.consumedAt))),
    activityPoints: getActivityPoints(state),
    soberPoints: getActivityPoints(state, { categories: SOBER_CATEGORIES }),
  };
}

function allCategoryAchievement(
  id: string,
  title: string,
  category: MenuCategory,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  const targets = getItemIdsByCategory(category);
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ uniqueItemIds }) => ({
      current: countConsumedTargets(uniqueItemIds, targets),
      target: targets.length,
    }),
  };
}

function countCategoryAchievement(
  id: string,
  title: string,
  category: MenuCategory,
  target: number,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  const targets = getItemIdsByCategory(category);
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ uniqueItemIds }) => ({
      current: Math.min(countConsumedTargets(uniqueItemIds, targets), target),
      target,
    }),
  };
}

function allTaggedAchievement(
  id: string,
  title: string,
  tag: string,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  const targets = getItemIdsByTag(tag);
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ uniqueItemIds }) => ({
      current: countConsumedTargets(uniqueItemIds, targets),
      target: targets.length,
    }),
  };
}

function distinctItemsAchievement(
  id: string,
  title: string,
  target: number,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ uniqueItemIds }) => ({
      current: Math.min(uniqueItemIds.size, target),
      target,
    }),
  };
}

function visitDaysAchievement(
  id: string,
  title: string,
  target: number,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ visitDays }) => ({
      current: Math.min(visitDays.size, target),
      target,
    }),
  };
}

function itemAchievement(
  id: string,
  title: string,
  menuItem: MenuItem | undefined,
  bonusPoints: number,
  description: string,
): AchievementDefinition {
  return {
    id,
    title,
    description,
    bonusPoints,
    getProgress: ({ uniqueItemIds }) => ({
      current: menuItem && uniqueItemIds.has(menuItem.id) ? 1 : 0,
      target: 1,
    }),
  };
}

function caffeineAchievement(): AchievementDefinition {
  const groups = [
    getItemIdsByTag('espresso'),
    getItemIdsByTag('cappuccino'),
    getItemIdsByTag('latte'),
    getItemIdsByTag('tea'),
  ];
  return {
    id: 'caffeine-demon',
    title: 'Kofeinový démon',
    description: 'Espresso, cappuccino, latte a aspoň jeden čaj.',
    bonusPoints: 200,
    getProgress: ({ uniqueItemIds }) => ({
      current: groups.filter((group) => group.some((itemId) => uniqueItemIds.has(itemId))).length,
      target: groups.length,
    }),
  };
}

function everyCategoryAchievement(): AchievementDefinition {
  return {
    id: 'category-taster',
    title: 'Ochutnávač',
    description: 'Alespoň jedna položka z každé kategorie.',
    bonusPoints: 700,
    getProgress: ({ uniqueItemIds }) => {
      const consumedCategories = new Set<MenuCategory>();
      uniqueItemIds.forEach((itemId) => {
        const menuItem = MENU_ITEM_BY_ID.get(itemId);
        if (menuItem) {
          consumedCategories.add(menuItem.category);
        }
      });
      return {
        current: consumedCategories.size,
        target: MENU_CATEGORY_ORDER.length,
      };
    },
  };
}

function completeMenuAchievement(): AchievementDefinition {
  return {
    id: 'completionist',
    title: 'Kompletista',
    description: 'Každá položka tajného menu.',
    bonusPoints: 3000,
    getProgress: ({ uniqueItemIds }) => ({
      current: countConsumedTargets(
        uniqueItemIds,
        MENU_ITEMS.map((menuItem) => menuItem.id),
      ),
      target: MENU_ITEMS.length,
    }),
  };
}

function soberLegendAchievement(): AchievementDefinition {
  return {
    id: 'sober-legend',
    title: 'Střízlivá legenda',
    description: '3000 bodů jen z nealka, kávy, čaje a jídla.',
    bonusPoints: 800,
    getProgress: ({ soberPoints }) => ({
      current: Math.min(soberPoints, 3000),
      target: 3000,
    }),
  };
}

export const SECRET_MENU_ACHIEVEMENTS: AchievementDefinition[] = [
  allCategoryAchievement('beer-lover', 'Pivař', 'draft-beer', 200, 'Všechna točená piva.'),
  allCategoryAchievement('driver', 'Řidič', 'soft-drinks', 300, 'Všechno nealko.'),
  caffeineAchievement(),
  allTaggedAchievement('lemonade-king', 'Limonádový král', 'lemonade', 200, 'Všechny limonády.'),
  allCategoryAchievement('gourmet', 'Gurmán', 'food-snacks', 300, 'Všechno jídlo a chuťovky.'),
  distinctItemsAchievement('explorer', 'Objevitel', 20, 300, '20 různých položek.'),
  distinctItemsAchievement('menu-traveler', 'Cestovatel menu', 50, 600, '50 různých položek.'),
  distinctItemsAchievement('menu-legend', 'Legenda menu', 100, 1000, '100 různých položek.'),
  allCategoryAchievement('tatra-master', 'Tatra Master', 'tatratea', 500, 'Všechny Tatratea.'),
  countCategoryAchievement('rum-collector', 'Rumový sběratel', 'rum', 15, 400, '15 různých rumů.'),
  allCategoryAchievement('rum-king', 'Rumový král', 'rum', 1000, 'Všechny rumy.'),
  allCategoryAchievement('whisky-master', 'Whisky Master', 'whisky', 400, 'Všechny whisky.'),
  allCategoryAchievement('gin-lover', 'Gin Lover', 'gin', 400, 'Všechny giny.'),
  allCategoryAchievement('vodka-expert', 'Vodka Expert', 'vodka', 400, 'Všechny vodky.'),
  allCategoryAchievement('sommelier', 'Someliér', 'wine', 500, 'Všechna vína.'),
  allCategoryAchievement('bubbles', 'Bublinky', 'sparkling-wine', 300, 'Všechna šumivá vína.'),
  itemAchievement(
    'strong-one',
    'Silák',
    MENU_ITEMS.find((menuItem) => menuItem.tags.includes('bezpravi-72')),
    150,
    'Tatratea 72% Bezpráví.',
  ),
  visitDaysAchievement('regular', 'Štamgast', 3, 200, 'Návštěva ve 3 různých dnech.'),
  visitDaysAchievement('loyal-guest', 'Věrný host', 10, 600, 'Návštěva v 10 různých dnech.'),
  visitDaysAchievement('home-local', 'Domácí', 25, 1500, 'Návštěva ve 25 různých dnech.'),
  soberLegendAchievement(),
  everyCategoryAchievement(),
  completeMenuAchievement(),
];

export function createEmptySecretMenuState(): SecretMenuState {
  return { consumedItems: [] };
}

export function normalizeSecretMenuState(value: unknown): SecretMenuState {
  if (!value || typeof value !== 'object' || !('consumedItems' in value)) {
    return createEmptySecretMenuState();
  }
  const consumedItems = Array.isArray(value.consumedItems) ? value.consumedItems : [];
  return {
    consumedItems: consumedItems
      .filter(
        (entry): entry is ConsumedMenuItem =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          'id' in entry &&
          'itemId' in entry &&
          'consumedAt' in entry &&
          typeof entry.id === 'string' &&
          typeof entry.itemId === 'string' &&
          typeof entry.consumedAt === 'string',
      )
      .filter((entry) => MENU_ITEM_BY_ID.has(entry.itemId)),
  };
}

export function addConsumedItem(
  state: SecretMenuState,
  itemId: string,
  consumedAt?: Date | string | number,
): SecretMenuState {
  if (!MENU_ITEM_BY_ID.has(itemId)) {
    throw new Error(`Unknown menu item: ${itemId}`);
  }
  const timestamp = normalizeConsumedAt(consumedAt);
  const nextEntry: ConsumedMenuItem = {
    id: `${itemId}-${timestamp}-${state.consumedItems.length + 1}`,
    itemId,
    consumedAt: timestamp,
  };
  return {
    consumedItems: [...state.consumedItems, nextEntry],
  };
}

export function removeConsumedItem(state: SecretMenuState, entryId: string): SecretMenuState {
  return {
    consumedItems: state.consumedItems.filter((entry) => entry.id !== entryId),
  };
}

export function getAchievementProgress(state: SecretMenuState): AchievementProgress[] {
  const context = createContext(state);
  return SECRET_MENU_ACHIEVEMENTS.map((achievement) => {
    const progress = achievement.getProgress(context);
    const current = Math.max(0, progress.current);
    const target = Math.max(0, progress.target);
    return {
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      bonusPoints: achievement.bonusPoints,
      current,
      target,
      progressPercent: clampPercent(current, target),
      unlocked: target > 0 && current >= target,
    };
  });
}

export function getUnlockedAchievements(state: SecretMenuState) {
  return getAchievementProgress(state).filter((achievement) => achievement.unlocked);
}

export function getUserPoints(state: SecretMenuState) {
  const achievementBonus = getUnlockedAchievements(state).reduce(
    (sum, achievement) => sum + achievement.bonusPoints,
    0,
  );
  return getActivityPoints(state) + achievementBonus;
}

export function getUserLevel(pointsOrState: number | SecretMenuState) {
  const points = typeof pointsOrState === 'number' ? pointsOrState : getUserPoints(pointsOrState);
  return SECRET_MENU_LEVELS.reduce(
    (current, level) => (points >= level.minPoints ? level : current),
    SECRET_MENU_LEVELS[0],
  );
}

export function getProgressToNextLevel(state: SecretMenuState): LevelProgress {
  const points = getUserPoints(state);
  const currentLevel = getUserLevel(points);
  const currentIndex = SECRET_MENU_LEVELS.findIndex((level) => level.id === currentLevel.id);
  const nextLevel = currentIndex >= 0 ? SECRET_MENU_LEVELS[currentIndex + 1] ?? null : null;
  if (!nextLevel) {
    return {
      points,
      currentLevel,
      nextLevel: null,
      pointsInCurrentLevel: points - currentLevel.minPoints,
      pointsNeededForNextLevel: 0,
      progressPercent: 100,
    };
  }
  const levelSpan = nextLevel.minPoints - currentLevel.minPoints;
  const pointsInCurrentLevel = Math.max(0, points - currentLevel.minPoints);
  return {
    points,
    currentLevel,
    nextLevel,
    pointsInCurrentLevel,
    pointsNeededForNextLevel: Math.max(0, nextLevel.minPoints - points),
    progressPercent: clampPercent(pointsInCurrentLevel, levelSpan),
  };
}

export function getCategoryProgress(state: SecretMenuState): CategoryProgress[] {
  const entries = getKnownEntries(state);
  const uniqueItemIds = getUniqueItemIds(entries);
  return MENU_CATEGORY_ORDER.map((category) => {
    const itemsInCategory = getItemsByCategory(category);
    const itemIdsInCategory = itemsInCategory.map((menuItem) => menuItem.id);
    const consumedItems = countConsumedTargets(uniqueItemIds, itemIdsInCategory);
    const totalConsumed = entries.filter((entry) => MENU_ITEM_BY_ID.get(entry.itemId)?.category === category).length;
    return {
      category,
      label: MENU_CATEGORY_LABELS[category],
      totalItems: itemsInCategory.length,
      consumedItems,
      totalConsumed,
      points: getActivityPoints(state, { categories: new Set([category]) }),
      completionPercent: clampPercent(consumedItems, itemsInCategory.length),
    };
  });
}

export function getMenuCompletion(state: SecretMenuState): MenuCompletion {
  const uniqueItemIds = getUniqueItemIds(getKnownEntries(state));
  const consumedItems = countConsumedTargets(
    uniqueItemIds,
    MENU_ITEMS.map((menuItem) => menuItem.id),
  );
  return {
    totalItems: MENU_ITEMS.length,
    consumedItems,
    percent: clampPercent(consumedItems, MENU_ITEMS.length),
  };
}

export function getStatistics(state: SecretMenuState) {
  const entries = getKnownEntries(state);
  const uniqueItemIds = getUniqueItemIds(entries);
  return {
    totalPoints: getUserPoints(state),
    currentLevel: getUserLevel(state),
    progressToNextLevel: getProgressToNextLevel(state),
    achievements: getAchievementProgress(state),
    unlockedAchievements: getUnlockedAchievements(state),
    menuCompletion: getMenuCompletion(state),
    categoryProgress: getCategoryProgress(state),
    totalConsumed: entries.length,
    uniqueConsumedItems: uniqueItemIds.size,
    visitDays: new Set(entries.map((entry) => normalizeDateKey(entry.consumedAt))).size,
    soberPoints: getActivityPoints(state, { categories: SOBER_CATEGORIES }),
    history: entries
      .map((entry) => ({
        ...entry,
        item: MENU_ITEM_BY_ID.get(entry.itemId),
      }))
      .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt)),
  };
}
