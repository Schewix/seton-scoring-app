import { expect, test, type Page } from '@playwright/test';
import { clearStationData, supabaseAdmin } from './supabase';
import { seedData } from './seedData';
import { ROUTE_PREFIX } from '../src/routing';

const patrol = seedData.patrols[0];

function pointsLabel(points: number) {
  if (points === 1) {
    return '1 bod';
  }
  if (points >= 2 && points <= 4) {
    return `${points} body`;
  }
  return `${points} bodů`;
}

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
  await page.getByRole('option', { name: pointsLabel(points) }).click();
}

async function flushIfNeeded(page: Page) {
  const sendButton = page.getByRole('button', { name: 'Odeslat nyní' });
  if (await sendButton.isVisible()) {
    await sendButton.click({ timeout: 2000 }).catch(() => {});
  }
}

async function waitForOutboxEmpty(page: Page) {
  await expect(page.getByText(/Čeká na odeslání:/)).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Načtení hlídek' })).toBeVisible();
  await expect(page.getByText(/Čeká na odeslání: 1/)).toBeVisible();

  await context.setOffline(false);
  await flushIfNeeded(page);
  await waitForOutboxEmpty(page);

  const { data } = await supabaseAdmin
    .from('station_scores')
    .select('points')
    .eq('event_id', seedData.eventId)
    .eq('station_id', seedData.stationId)
    .eq('patrol_id', patrol.id)
    .maybeSingle();

  expect(data?.points).toBe(6);
});
