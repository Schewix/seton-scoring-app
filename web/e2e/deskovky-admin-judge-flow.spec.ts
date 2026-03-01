import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { supabaseAdmin } from './supabase';
import { seedData } from './seedData';
import {
  DESKOVKY_ADMIN_ROUTE,
  DESKOVKY_MATCH_NEW_ROUTE,
  DESKOVKY_STANDINGS_ROUTE,
} from '../src/routing';

type SeededBoardEvent = {
  eventId: string;
  gameIds: string[];
  gameNames: string[];
  categoryId: string;
  blockIds: string[];
  playerIds: string[];
  playerCodes: string[];
  extraJudgeIds: string[];
};

async function createBypassContext(
  browser: Browser,
  stationCode: 'T' | 'X',
  viewport?: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport });
  await context.addInitScript((code) => {
    window.localStorage.setItem('auth:bypass:stationCode', code);
  }, stationCode);
  const page = await context.newPage();
  return { context, page };
}

async function selectAdminEvent(page: Page, eventId: string) {
  await page.goto(`${DESKOVKY_ADMIN_ROUTE}#prehled`);
  const eventSelect = page.getByLabel('Aktivní event Deskovek');
  await expect(eventSelect).toBeVisible();
  await eventSelect.selectOption(eventId);
  await page.goto(`${DESKOVKY_ADMIN_ROUTE}#losovani`);
}

async function setStationCode(code: 'T' | 'X') {
  const { error } = await supabaseAdmin
    .from('stations')
    .update({ code })
    .eq('id', seedData.stationId);
  if (error) {
    throw new Error(`Failed to switch station code to ${code}: ${error.message}`);
  }
}

async function clearE2eBoardEvents() {
  await supabaseAdmin.from('board_event').delete().like('slug', 'e2e-board%');
}

async function seedBoardEvent(options?: { withManualMatch?: boolean }): Promise<SeededBoardEvent> {
  await clearE2eBoardEvents();
  const eventId = crypto.randomUUID();
  const gameId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const blockId = crypto.randomUUID();
  const secondaryJudgeId = crypto.randomUUID();
  const gameName = 'Kris kros';
  const playerIds = Array.from({ length: 12 }, () => crypto.randomUUID());
  const playerCodes = playerIds.map((_, index) => `T-${String(index + 1).padStart(2, '0')}`);

  const assert = async (error: { message?: string } | null, label: string) => {
    if (!error) {
      return;
    }
    throw new Error(`${label}: ${error.message ?? 'unknown error'}`);
  };

  await assert(
    (await supabaseAdmin.from('board_event').insert({
      id: eventId,
      slug: `e2e-board-${eventId.slice(0, 8)}`,
      name: `E2E Deskovky ${eventId.slice(0, 6)}`,
      start_date: '2099-12-31',
    })).error,
    'insert board_event',
  );

  await assert(
    (await supabaseAdmin.from('board_game').insert({
      id: gameId,
      event_id: eventId,
      name: gameName,
      scoring_type: 'points',
      points_order: 'desc',
      three_player_adjustment: false,
    })).error,
    'insert board_game',
  );

  await assert(
    (await supabaseAdmin.from('board_category').insert({
      id: categoryId,
      event_id: eventId,
      name: 'Kategorie V',
      primary_game_id: gameId,
    })).error,
    'insert board_category',
  );

  await assert(
    (await supabaseAdmin.from('board_block').insert({
      id: blockId,
      event_id: eventId,
      category_id: categoryId,
      block_number: 1,
      game_id: gameId,
    })).error,
    'insert board_block',
  );

  await assert(
    (await supabaseAdmin.from('board_player').insert(
      playerIds.map((playerId, index) => ({
        id: playerId,
        event_id: eventId,
        short_code: playerCodes[index],
        team_name: `${(index % 6) + 1}. PTO`,
        display_name: `Hrac ${index + 1}`,
        category_id: categoryId,
        disqualified: false,
      })),
    )).error,
    'insert board_player',
  );

  await assert(
    (await supabaseAdmin.from('judges').insert({
      id: secondaryJudgeId,
      email: `board-judge-${secondaryJudgeId}@example.com`,
      password_hash: 'hash',
      display_name: 'Secondary Board Judge',
    })).error,
    'insert secondary judge',
  );

  await assert(
    (await supabaseAdmin.from('board_judge_assignment').insert([
      {
        event_id: eventId,
        user_id: seedData.judgeId,
        game_id: gameId,
        category_id: null,
        table_number: 1,
      },
      {
        event_id: eventId,
        user_id: seedData.judgeId,
        game_id: gameId,
        category_id: null,
        table_number: 2,
      },
      {
        event_id: eventId,
        user_id: secondaryJudgeId,
        game_id: gameId,
        category_id: null,
        table_number: 3,
      },
    ])).error,
    'insert board_judge_assignment',
  );

  if (options?.withManualMatch) {
    const matchId = crypto.randomUUID();
    await assert(
      (await supabaseAdmin.from('board_match').insert({
        id: matchId,
        event_id: eventId,
        category_id: categoryId,
        block_id: blockId,
        round_number: 1,
        table_number: 1,
        created_by: seedData.judgeId,
        status: 'submitted',
      })).error,
      'insert board_match',
    );

    await assert(
      (await supabaseAdmin.from('board_match_player').insert(
        playerIds.slice(0, 4).map((playerId, index) => ({
          match_id: matchId,
          player_id: playerId,
          seat: index + 1,
          points: null,
          placement: null,
        })),
      )).error,
      'insert board_match_player',
    );
  }

  return {
    eventId,
    gameIds: [gameId],
    gameNames: [gameName],
    categoryId,
    blockIds: [blockId],
    playerIds,
    playerCodes,
    extraJudgeIds: [secondaryJudgeId],
  };
}

async function seedBoardEventWithMultiGameNullTables(): Promise<SeededBoardEvent> {
  await clearE2eBoardEvents();
  const eventId = crypto.randomUUID();
  const categoryId = crypto.randomUUID();
  const gameIds = [crypto.randomUUID(), crypto.randomUUID()];
  const gameNames = ['Kris kros', 'Dominion'];
  const blockIds = [crypto.randomUUID(), crypto.randomUUID()];
  const secondaryJudgeId = crypto.randomUUID();
  const playerIds = Array.from({ length: 8 }, () => crypto.randomUUID());
  const playerCodes = playerIds.map((_, index) => `M-${String(index + 1).padStart(2, '0')}`);

  const assert = async (error: { message?: string } | null, label: string) => {
    if (!error) {
      return;
    }
    throw new Error(`${label}: ${error.message ?? 'unknown error'}`);
  };

  await assert(
    (await supabaseAdmin.from('board_event').insert({
      id: eventId,
      slug: `e2e-board-multi-${eventId.slice(0, 8)}`,
      name: `E2E Deskovky Multi ${eventId.slice(0, 6)}`,
      start_date: '2099-12-31',
    })).error,
    'insert board_event',
  );

  await assert(
    (await supabaseAdmin.from('board_game').insert([
      {
        id: gameIds[0],
        event_id: eventId,
        name: gameNames[0],
        scoring_type: 'points',
        points_order: 'desc',
        three_player_adjustment: false,
      },
      {
        id: gameIds[1],
        event_id: eventId,
        name: gameNames[1],
        scoring_type: 'points',
        points_order: 'desc',
        three_player_adjustment: false,
      },
    ])).error,
    'insert board_game',
  );

  await assert(
    (await supabaseAdmin.from('board_category').insert({
      id: categoryId,
      event_id: eventId,
      name: 'Kategorie VI',
      primary_game_id: gameIds[0],
    })).error,
    'insert board_category',
  );

  await assert(
    (await supabaseAdmin.from('board_block').insert([
      {
        id: blockIds[0],
        event_id: eventId,
        category_id: categoryId,
        block_number: 1,
        game_id: gameIds[0],
      },
      {
        id: blockIds[1],
        event_id: eventId,
        category_id: categoryId,
        block_number: 2,
        game_id: gameIds[1],
      },
    ])).error,
    'insert board_block',
  );

  await assert(
    (await supabaseAdmin.from('board_player').insert(
      playerIds.map((playerId, index) => ({
        id: playerId,
        event_id: eventId,
        short_code: playerCodes[index],
        team_name: `${(index % 6) + 1}. PTO`,
        display_name: `Multi Hrac ${index + 1}`,
        category_id: categoryId,
        disqualified: false,
      })),
    )).error,
    'insert board_player',
  );

  await assert(
    (await supabaseAdmin.from('judges').insert({
      id: secondaryJudgeId,
      email: `board-judge-${secondaryJudgeId}@example.com`,
      password_hash: 'hash',
      display_name: 'Secondary Board Judge',
    })).error,
    'insert secondary judge',
  );

  await assert(
    (await supabaseAdmin.from('board_judge_assignment').insert([
      {
        event_id: eventId,
        user_id: seedData.judgeId,
        game_id: gameIds[0],
        category_id: null,
        table_number: null,
      },
      {
        event_id: eventId,
        user_id: secondaryJudgeId,
        game_id: gameIds[0],
        category_id: null,
        table_number: null,
      },
      {
        event_id: eventId,
        user_id: seedData.judgeId,
        game_id: gameIds[1],
        category_id: null,
        table_number: null,
      },
      {
        event_id: eventId,
        user_id: secondaryJudgeId,
        game_id: gameIds[1],
        category_id: null,
        table_number: null,
      },
    ])).error,
    'insert board_judge_assignment',
  );

  return {
    eventId,
    gameIds,
    gameNames,
    categoryId,
    blockIds,
    playerIds,
    playerCodes,
    extraJudgeIds: [secondaryJudgeId],
  };
}

async function cleanupBoardEvent(seed: SeededBoardEvent) {
  await supabaseAdmin.from('board_event').delete().eq('id', seed.eventId);
  if (seed.extraJudgeIds.length) {
    await supabaseAdmin.from('judges').delete().in('id', seed.extraJudgeIds);
  }
}

test.describe('Deskovky admin/judge flow', () => {
  test.beforeEach(async () => {
    await setStationCode('T');
  });

  test.afterAll(async () => {
    await setStationCode('X');
  });

  test('admin runs draw, judge sees only own tables and submitted points are visible in standings', async ({ browser }) => {
    const seed = await seedBoardEvent();
    let adminContext: BrowserContext | null = null;
    let judgeContext: BrowserContext | null = null;
    let standingsContext: BrowserContext | null = null;

    try {
      const admin = await createBypassContext(browser, 'T');
      adminContext = admin.context;
      await selectAdminEvent(admin.page, seed.eventId);
      const startDrawButton = admin.page.getByRole('button', { name: 'Spustit losování' });
      await expect(startDrawButton).toBeVisible();
      admin.page.once('dialog', (dialog) => void dialog.accept());
      await startDrawButton.click();
      await expect(admin.page.getByText('Losování bylo úspěšně vytvořeno.')).toBeVisible({ timeout: 90_000 });
      await admin.context.close();
      adminContext = null;

      const judge = await createBypassContext(browser, 'X');
      judgeContext = judge.context;
      await judge.page.goto(DESKOVKY_MATCH_NEW_ROUTE);
      await expect(judge.page.getByRole('heading', { name: 'Partie u stolu' })).toBeVisible();

      const stationSelect = judge.page.locator('label:has-text("Blok / hra / stůl") select');
      await expect(stationSelect).toBeVisible();
      const stationOptions = await stationSelect.locator('option').allTextContents();
      expect(stationOptions.some((option) => option.includes('stůl 1'))).toBe(true);
      expect(stationOptions.some((option) => option.includes('stůl 2'))).toBe(true);
      expect(stationOptions.some((option) => option.includes('stůl 3'))).toBe(false);

      const firstRowTeam = (await judge.page.locator('table tbody tr').first().locator('td').nth(2).textContent() ?? '').trim();
      expect(firstRowTeam).not.toHaveLength(0);

      const pointInputs = judge.page.locator('table tbody input[type="number"]');
      await expect(pointInputs).toHaveCount(4);
      for (const [index, value] of [40, 30, 20, 10].entries()) {
        await pointInputs.nth(index).fill(String(value));
      }

      await judge.page.getByRole('button', { name: 'Uložit výsledky partie' }).click();
      await expect(judge.page.getByText('Výsledky partie byly uloženy.')).toBeVisible();
      await judge.context.close();
      judgeContext = null;

      const standings = await createBypassContext(browser, 'T');
      standingsContext = standings.context;
      await standings.page.goto(DESKOVKY_STANDINGS_ROUTE);
      await expect(standings.page.getByRole('heading', { name: 'Průběžné pořadí' })).toBeVisible();
      await standings.page.getByLabel('Event').selectOption(seed.eventId);

      const gameSection = standings.page.locator('section.admin-card', {
        has: standings.page.getByRole('heading', { name: seed.gameNames[0] }),
      }).first();
      await expect(gameSection).toBeVisible();

      const topRow = gameSection.locator('tbody tr').first();
      await expect(topRow).toContainText(firstRowTeam);
    } finally {
      if (adminContext) {
        await adminContext.close().catch(() => {});
      }
      if (judgeContext) {
        await judgeContext.close().catch(() => {});
      }
      if (standingsContext) {
        await standingsContext.close().catch(() => {});
      }
      await cleanupBoardEvent(seed);
    }
  });

  test('draw assigns matches even when one judge has multiple games and table_number is null', async ({ browser }) => {
    const seed = await seedBoardEventWithMultiGameNullTables();
    let adminContext: BrowserContext | null = null;
    let judgeContext: BrowserContext | null = null;

    try {
      const admin = await createBypassContext(browser, 'T');
      adminContext = admin.context;
      await selectAdminEvent(admin.page, seed.eventId);
      const startDrawButton = admin.page.getByRole('button', { name: 'Spustit losování' });
      await expect(startDrawButton).toBeVisible();
      admin.page.once('dialog', (dialog) => void dialog.accept());
      await startDrawButton.click();
      await expect(admin.page.getByText('Losování bylo úspěšně vytvořeno.')).toBeVisible({ timeout: 90_000 });
      await admin.context.close();
      adminContext = null;

      const [matchRes, blockRes] = await Promise.all([
        supabaseAdmin
          .from('board_match')
          .select('id, block_id, created_by')
          .eq('event_id', seed.eventId)
          .eq('created_by', seedData.judgeId),
        supabaseAdmin
          .from('board_block')
          .select('id, game_id')
          .eq('event_id', seed.eventId),
      ]);
      const blocksById = new Map((blockRes.data ?? []).map((row) => [row.id, row.game_id]));
      const createdGameIds = new Set(
        (matchRes.data ?? [])
          .map((row) => blocksById.get(row.block_id))
          .filter((value): value is string => Boolean(value)),
      );
      expect(createdGameIds.has(seed.gameIds[0])).toBe(true);
      expect(createdGameIds.has(seed.gameIds[1])).toBe(true);

      const judge = await createBypassContext(browser, 'X');
      judgeContext = judge.context;
      await judge.page.goto(DESKOVKY_MATCH_NEW_ROUTE);
      const stationSelect = judge.page.locator('label:has-text("Blok / hra / stůl") select');
      await expect(stationSelect).toBeVisible();
      const options = await stationSelect.locator('option').allTextContents();

      expect(options.some((label) => label.includes('Kris kros'))).toBe(true);
    } finally {
      if (adminContext) {
        await adminContext.close().catch(() => {});
      }
      if (judgeContext) {
        await judgeContext.close().catch(() => {});
      }
      await cleanupBoardEvent(seed);
    }
  });

  test('mobile layout has no horizontal scroll in Novy zapas, Losovani and Rozhodci a stoly', async ({ browser }) => {
    const seed = await seedBoardEvent({ withManualMatch: true });
    let judgeContext: BrowserContext | null = null;
    let adminContext: BrowserContext | null = null;
    const mobileViewport = { width: 390, height: 844 };

    const assertNoHorizontalOverflow = async (page: Page, selector?: string) => {
      const hasNoOverflow = await page.evaluate((targetSelector) => {
        const target = targetSelector
          ? document.querySelector<HTMLElement>(targetSelector)
          : document.documentElement;
        if (!target) {
          return false;
        }
        return target.scrollWidth <= target.clientWidth + 1;
      }, selector ?? null);
      expect(hasNoOverflow).toBe(true);
    };

    try {
      const judge = await createBypassContext(browser, 'X', mobileViewport);
      judgeContext = judge.context;
      await judge.page.goto(DESKOVKY_MATCH_NEW_ROUTE);
      await expect(judge.page.getByRole('heading', { name: 'Partie u stolu' })).toBeVisible();
      await assertNoHorizontalOverflow(judge.page);
      await assertNoHorizontalOverflow(judge.page, 'section.admin-card');

      const admin = await createBypassContext(browser, 'T', mobileViewport);
      adminContext = admin.context;
      await admin.page.goto(`${DESKOVKY_ADMIN_ROUTE}#losovani`);
      await expect(admin.page.getByRole('heading', { name: 'Losování partií' })).toBeVisible();
      await assertNoHorizontalOverflow(admin.page);
      await assertNoHorizontalOverflow(admin.page, 'section.admin-card');

      await admin.page.goto(`${DESKOVKY_ADMIN_ROUTE}#stoly`);
      await expect(admin.page.getByRole('heading', { name: 'Rozhodčí a stoly' })).toBeVisible();
      await assertNoHorizontalOverflow(admin.page);
      await assertNoHorizontalOverflow(admin.page, 'section.admin-card');
    } finally {
      if (judgeContext) {
        await judgeContext.close().catch(() => {});
      }
      if (adminContext) {
        await adminContext.close().catch(() => {});
      }
      await cleanupBoardEvent(seed);
    }
  });
});
