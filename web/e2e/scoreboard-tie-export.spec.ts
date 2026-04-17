import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { SCOREBOARD_ROUTE_PREFIX } from '../src/routing';
import { seedData } from './seedData';

const TIE_PATROL_CODES = ['MH-E2E-TIE-1', 'MH-E2E-TIE-2'] as const;

type RawScoreboardRow = {
  event_id: string;
  event_name: string;
  patrol_id: string;
  patrol_code: string;
  team_name: string;
  category: string;
  sex: string;
  disqualified: boolean;
  patrol_members: string;
  start_time: string;
  finish_time: string;
  total_seconds: number;
  wait_seconds: number;
  total_points: number;
  points_no_t: number;
  pure_seconds: number;
  time_points: number;
  station_points_breakdown: Record<string, number>;
  rank_in_bracket: number;
};

const MOCK_ROWS: RawScoreboardRow[] = [
  {
    event_id: seedData.eventId,
    event_name: 'E2E Event',
    patrol_id: '11111111-1111-1111-1111-111111111111',
    patrol_code: TIE_PATROL_CODES[0],
    team_name: 'Tie Team 1',
    category: 'M',
    sex: 'H',
    disqualified: false,
    patrol_members: 'Alice (A)\nBob (B)',
    start_time: '2026-01-01T10:00:00.000Z',
    finish_time: '2026-01-01T11:01:40.000Z',
    total_seconds: 3700,
    wait_seconds: 0,
    total_points: 34,
    points_no_t: 34,
    pure_seconds: 3700,
    time_points: 0,
    station_points_breakdown: { A: 12, B: 11, C: 11 },
    rank_in_bracket: 1,
  },
  {
    event_id: seedData.eventId,
    event_name: 'E2E Event',
    patrol_id: '22222222-2222-2222-2222-222222222222',
    patrol_code: TIE_PATROL_CODES[1],
    team_name: 'Tie Team 2',
    category: 'M',
    sex: 'H',
    disqualified: false,
    patrol_members: 'Carol (C)\nDavid (D)',
    start_time: '2026-01-01T10:00:00.000Z',
    finish_time: '2026-01-01T11:01:40.000Z',
    total_seconds: 3700,
    wait_seconds: 0,
    total_points: 34,
    points_no_t: 34,
    pure_seconds: 3700,
    time_points: 0,
    station_points_breakdown: { A: 12, B: 11, C: 11 },
    rank_in_bracket: 1,
  },
];

function readRowValues(worksheet: ExcelJS.Worksheet, rowNumber: number) {
  const row = worksheet.getRow(rowNumber);
  return row.values as Array<string | number | null | undefined>;
}

async function mockScoreboardSupabaseApis(page: Page) {
  await page.addInitScript(({ rows }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const requestUrl = typeof input === 'string' ? input : request?.url ?? '';

      if (!requestUrl.includes('/rest/v1/')) {
        return originalFetch(input, init);
      }

      const url = new URL(requestUrl, window.location.origin);
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });

      if (url.pathname.endsWith('/rest/v1/events')) {
        return json({ name: 'E2E Event' });
      }
      if (url.pathname.endsWith('/rest/v1/stations')) {
        return json([{ code: 'A' }, { code: 'B' }, { code: 'C' }]);
      }
      if (url.pathname.endsWith('/rest/v1/scoreboard_view')) {
        return json(rows);
      }
      if (url.pathname.endsWith('/rest/v1/patrols')) {
        return json([]);
      }

      return json([]);
    };
  }, { rows: MOCK_ROWS });
}

test('scoreboard marks complete 1-5 tie in table and export', async ({ page }) => {
  await mockScoreboardSupabaseApis(page);

  await page.goto(SCOREBOARD_ROUTE_PREFIX);
  await expect(page.getByRole('heading', { name: 'Pořadí podle kategorií' })).toBeVisible();
  await expect(page.getByText('Načítám data…')).toHaveCount(0, { timeout: 15_000 });

  const mhGroup = page.locator('.scoreboard-group', {
    has: page.getByRole('heading', { name: 'MH' }),
  }).first();
  await expect(mhGroup).toBeVisible();
  await expect(page.getByText('Položky označené * mají shodu i po kritériích 1-5.')).toBeVisible();
  await expect(mhGroup.getByText('Shoda po kritériích 1-5 (2 hlídky)')).toHaveCount(2);
  await expect(mhGroup.getByText('1*')).toHaveCount(2);
  await expect(mhGroup).toContainText(TIE_PATROL_CODES[0]);
  await expect(mhGroup).toContainText(TIE_PATROL_CODES[1]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportovat výsledky' }).click(),
  ]);

  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(downloadedPath!);
  const worksheet = workbook.getWorksheet('MH');
  expect(worksheet).toBeDefined();

  const headerValues = readRowValues(worksheet!, 1).slice(1);
  expect(headerValues[0]).toBe('Shoda po 1-5');
  expect(headerValues[1]).toBe('Hlídka');
  expect(headerValues[headerValues.length - 1]).toBe('Body celkem');

  const firstDataRow = readRowValues(worksheet!, 2).slice(1);
  const secondDataRow = readRowValues(worksheet!, 3).slice(1);
  const dataRows = [firstDataRow, secondDataRow];

  const tieRows = dataRows.filter((cells) => String(cells[0] ?? '').startsWith('ANO (shoda o 1. místo; 2 hlídky)'));
  expect(tieRows).toHaveLength(2);
  expect(dataRows.some((cells) => cells[1] === TIE_PATROL_CODES[0])).toBe(true);
  expect(dataRows.some((cells) => cells[1] === TIE_PATROL_CODES[1])).toBe(true);
});
