import { expect, test, type Page, type Route } from '@playwright/test';

type NavigationMetrics = {
  domContentLoadedMs: number;
  loadEventMs: number;
  responseEndMs: number;
};

type LoadCase = {
  name: string;
  path: string;
  waitUntilReady: (page: Page) => Promise<void>;
};

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4175';

const PERF_BUDGETS = {
  domContentLoadedMs: readBudget('E2E_PUBLIC_DCL_MS', 1000),
  loadEventMs: readBudget('E2E_PUBLIC_LOAD_MS', 1000),
  pageReadyMs: readBudget('E2E_PUBLIC_READY_MS', 1000),
};

const MOCK_ARTICLE = {
  source: 'local' as const,
  slug: 'perf-test-article',
  title: 'Performance test article',
  excerpt: 'Short article excerpt for route render checks.',
  dateISO: '2026-01-10T09:00:00.000Z',
  author: 'E2E',
  coverImage: null,
  body: 'Performance test body',
  bodyFormat: 'text' as const,
};

const MOCK_ALBUM = {
  id: 'album-perf-1',
  title: 'Speed album',
  year: '2026',
  slug: '2026-speed-album',
  folderId: 'folder-speed-1',
};

const LOAD_CASES: LoadCase[] = [
  {
    name: 'homepage',
    path: '/',
    waitUntilReady: async (page) => {
      await expect(page.locator('#homepage-intro-heading')).toBeVisible();
      await expect(page.locator('a[href="/clanky/perf-test-article"]')).toBeVisible();
    },
  },
  {
    name: 'articles',
    path: '/clanky',
    waitUntilReady: async (page) => {
      await expect(page.locator('#articles-heading')).toBeVisible();
      await expect(page.locator('a[href="/clanky/perf-test-article"]')).toBeVisible();
    },
  },
  {
    name: 'gallery',
    path: '/fotogalerie',
    waitUntilReady: async (page) => {
      await expect(page.locator('#gallery-heading')).toBeVisible();
      await expect(page.locator('a.gallery-album-card[href="/fotogalerie/2026-speed-album"]')).toBeVisible();
    },
  },
];

function readBudget(envName: string, fallback: number) {
  const raw = process.env[envName];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fulfillJson(route: Route, payload: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  });
}

async function mockPublicApis(page: Page) {
  await page.route('**/api/content/articles**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/content/articles') {
      return fulfillJson(route, { articles: [MOCK_ARTICLE] });
    }
    if (url.pathname.startsWith('/api/content/articles/')) {
      return fulfillJson(route, { article: MOCK_ARTICLE });
    }
    return route.continue();
  });

  await page.route('**/api/content/league**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/content/league') {
      return route.continue();
    }
    return fulfillJson(route, { scores: [] });
  });

  await page.route('**/api/gallery**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/gallery') {
      return route.continue();
    }
    if (url.searchParams.get('years') === '1' || url.searchParams.get('years') === 'true') {
      return fulfillJson(route, { years: ['2026'] });
    }
    if (url.searchParams.has('year')) {
      return fulfillJson(route, { albums: [MOCK_ALBUM] });
    }
    const folderId = url.searchParams.get('folderId') ?? url.searchParams.get('folder');
    if (folderId) {
      return fulfillJson(route, {
        folderId,
        files: [],
        nextPageToken: null,
        totalCount: 12,
      });
    }
    return fulfillJson(route, { albums: [MOCK_ALBUM] });
  });
}

async function readNavigationMetrics(page: Page): Promise<NavigationMetrics> {
  return page.evaluate(() => {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!navEntry) {
      return {
        domContentLoadedMs: 0,
        loadEventMs: 0,
        responseEndMs: 0,
      };
    }
    return {
      domContentLoadedMs: Math.round(navEntry.domContentLoadedEventEnd),
      loadEventMs: Math.round(navEntry.loadEventEnd),
      responseEndMs: Math.round(navEntry.responseEnd),
    };
  });
}

async function measureRouteLoad(page: Page, routeCase: LoadCase) {
  await mockPublicApis(page);
  const startedAt = Date.now();
  await page.goto(routeCase.path, { waitUntil: 'domcontentloaded' });
  await routeCase.waitUntilReady(page);
  await page.waitForLoadState('load');
  const pageReadyMs = Date.now() - startedAt;
  const navigation = await readNavigationMetrics(page);
  return { ...navigation, pageReadyMs };
}

test.describe('Public pages load performance', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await mockPublicApis(page);
    await page.goto('/', { waitUntil: 'load' });
    await context.close();
  });

  for (const routeCase of LOAD_CASES) {
    test(`${routeCase.name} stays within loading budget`, async ({ page }, testInfo) => {
      const metrics = await measureRouteLoad(page, routeCase);
      await testInfo.attach(`${routeCase.name}-metrics`, {
        body: JSON.stringify(
          {
            route: routeCase.path,
            budgets: PERF_BUDGETS,
            metrics,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });

      expect(metrics.domContentLoadedMs).toBeGreaterThan(0);
      expect(metrics.loadEventMs).toBeGreaterThan(0);
      expect(metrics.domContentLoadedMs).toBeLessThan(PERF_BUDGETS.domContentLoadedMs);
      expect(metrics.loadEventMs).toBeLessThan(PERF_BUDGETS.loadEventMs);
      expect(metrics.pageReadyMs).toBeLessThan(PERF_BUDGETS.pageReadyMs);
    });
  }
});
