import { expect, test, type Page } from '@playwright/test';
import { clearStationData, supabaseAdmin } from './supabase';
import { seedData } from './seedData';
import { ROUTE_PREFIX } from '../src/routing';

const patrol = seedData.patrols[0];

async function openPatrolForm(page: Page, code: string) {
  await page.getByLabel('Zadání z klávesnice').fill(code);
  const confirmButton = page.getByRole('button', { name: 'Načíst hlídku' });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  const choiceDialog = page.getByRole('dialog');
  await choiceDialog.getByRole('button', { name: 'Obsluhovat' }).click();
  if (await choiceDialog.isVisible()) {
    await choiceDialog.getByRole('button', { name: 'Zavřít dialog' }).click();
    await expect(choiceDialog).toBeHidden();
  }

  const saveButton = page.getByRole('button', { name: 'Uložit záznam' });
  if (!(await saveButton.isVisible())) {
    const ticketRow = page.locator('.ticket', { hasText: code }).first();
    await expect(ticketRow).toBeVisible();
    await ticketRow.getByRole('button', { name: 'Hotovo' }).click();
  }
  await expect(saveButton).toBeVisible();
}

async function selectPoints(page: Page, points: number) {
  const pointsInput = page.getByLabel('Body (0 až 12)');
  await pointsInput.fill(String(points));
}

async function flushIfNeeded(page: Page) {
  const sendButton = page.getByRole('button', { name: 'Odeslat nyní' });
  if ((await sendButton.count()) === 0) {
    return;
  }
  const visible = await sendButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (!visible) {
    return;
  }
  const enabled = await sendButton.isEnabled({ timeout: 1000 }).catch(() => false);
  if (enabled) {
    await sendButton.click({ timeout: 2000 }).catch(() => {});
  }
}

async function waitForOutboxEmpty(page: Page) {
  const pendingBanner = page.getByText(/Čeká na odeslání:/);
  const start = Date.now();
  while (Date.now() - start < 25000) {
    if ((await pendingBanner.count()) === 0) {
      return;
    }
    await flushIfNeeded(page);
    await page.waitForTimeout(2000);
  }
  await expect(pendingBanner).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await clearStationData();
  await page.goto(ROUTE_PREFIX);
  await expect(page.getByRole('heading', { name: 'Načtení hlídek' })).toBeVisible();
});

test('outbox se po reloadu obnovi a synchronizuje po navratu online', async ({ page, context }) => {
  await context.setOffline(true);

  await openPatrolForm(page, patrol.patrol_code);
  await selectPoints(page, 6);
  await page.getByRole('button', { name: 'Uložit záznam' }).click();

  await expect(page.getByText(/Čeká na odeslání: 1/)).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.route('**/submit-station-record', async (route) => {
    const request = route.request();
    const rawBody = request.postData() ?? '{}';
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(rawBody) as Record<string, any>;
    } catch {
      payload = {};
    }

    await supabaseAdmin.rpc('submit_station_record', {
      p_event_id: payload.event_id,
      p_station_id: payload.station_id,
      p_patrol_id: payload.patrol_id,
      p_category: payload.category,
      p_arrived_at: payload.arrived_at,
      p_wait_minutes: payload.wait_minutes,
      p_points: payload.points,
      p_note: payload.note,
      p_use_target_scoring: payload.use_target_scoring,
      p_normalized_answers: payload.normalized_answers,
      p_finish_time: payload.finish_time,
      p_client_event_id: payload.client_event_id,
      p_client_created_at: payload.client_created_at,
      p_submitted_by: seedData.judgeId,
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await context.setOffline(false);
  await page.goto(ROUTE_PREFIX);
  await expect(page.getByRole('heading', { name: 'Načtení hlídek' })).toBeVisible();
  await expect(page.getByText(/Čeká na odeslání: 1/)).toBeVisible();
  const queueButton = page.getByRole('button', { name: 'Zobrazit frontu' });
  if (await queueButton.isVisible()) {
    await queueButton.click();
  }
  await flushIfNeeded(page);
  await waitForOutboxEmpty(page);
  await page.unroute('**/submit-station-record');

  const { data } = await supabaseAdmin
    .from('station_scores')
    .select('points')
    .eq('event_id', seedData.eventId)
    .eq('station_id', seedData.stationId)
    .eq('patrol_id', patrol.id)
    .maybeSingle();

  expect(data?.points).toBe(6);
});
