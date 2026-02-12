import { expect, test, type Page } from '@playwright/test';
import { clearStationData, supabaseAdmin } from './supabase';
import { seedData } from './seedData';
import { ROUTE_PREFIX } from '../src/routing';

const patrol = seedData.patrols[0];

async function openPatrolForm(page: Page, code: string) {
  const toggle = page.getByRole('button', { name: /Zobrazit ruční načítání kódů|Skrýt ruční načítání/ });
  if (await toggle.isVisible()) {
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await toggle.click();
    }
  }
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
  await expect(
    page.getByRole('button', { name: /Zobrazit ruční načítání kódů|Skrýt ruční načítání/ }),
  ).toBeVisible();
});

test('offline záznam se po návratu online synchronizuje', async ({ page, context }) => {
  await context.setOffline(true);
  await openPatrolForm(page, patrol.patrol_code);
  await selectPoints(page, 5);
  await page.getByRole('button', { name: 'Uložit záznam' }).click();

  await expect(page.getByText(/Čeká na odeslání: 1/)).toBeVisible();

  await context.setOffline(false);
  await flushIfNeeded(page);
  await waitForOutboxEmpty(page);
});

test('offline editace používá last-write-wins podle client_created_at', async ({ page, context }) => {
  await openPatrolForm(page, patrol.patrol_code);
  await selectPoints(page, 3);
  await page.getByRole('button', { name: 'Uložit záznam' }).click();
  await waitForOutboxEmpty(page);

  const lastScoresCard = page.locator('section', {
    has: page.getByRole('heading', { name: /Poslední záznamy/ }),
  });
  await lastScoresCard.getByRole('button', { name: 'Zobrazit záznamy' }).click();
  await lastScoresCard.getByRole('button', { name: 'Obnovit' }).click();

  const row = page.locator('.score-item', { hasText: patrol.team_name }).first();
  await expect(row).toBeVisible();

  await context.setOffline(true);
  await row.getByRole('button', { name: 'Upravit' }).click();
  await row.getByLabel('Body').fill('8');
  await row.getByRole('button', { name: 'Uložit změny' }).click();

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

  expect(data?.points).toBe(8);
});
