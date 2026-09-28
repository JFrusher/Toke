import { expect, type Page, test } from '@playwright/test';
import { importCsv, openDock } from './helpers';

/**
 * v1.1 — the rule builder writes SQL for people who don't, and saved queries
 * keep the ones people do write.
 */

const GUESTS = [
  'first_name,last_name,dietary_requirements',
  'Ada,Lovelace,Gluten free',
  'Grace,Hopper,',
].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function buildMenuRule(page: Page) {
  await openDock(page);
  await page.getByTestId('dock-tab-rules').click();
  await page.getByTestId('rule-add-column').click();
  await page.getByTestId('rule-name-0').fill('menu');
  await page.getByTestId('rule-add-0').click();
  await page.getByTestId('rule-column-0-0').selectOption('dietary_requirements');
  await page.getByTestId('rule-op-0-0').selectOption('contains');
  await page.getByTestId('rule-value-0-0').fill('gluten');
  await page.getByTestId('rule-then-0-0').fill('menu-gf');
  await page.getByTestId('rule-otherwise-0').fill('menu-standard');
}

test('rules become a column the design can bind to', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await buildMenuRule(page);

  // The SQL is shown, not hidden: the builder teaches as it goes.
  await expect(page.getByTestId('rule-sql')).toContainText('CASE');
  await page.getByTestId('rule-apply').click();

  // Reopening reads the rules back out of the record source.
  await expect(page.getByTestId('rule-name-0')).toHaveValue('menu', { timeout: 20_000 });

  // And the computed column is there to bind.
  await page.getByTestId('tool-rect').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await page.getByRole('treeitem').getByRole('button').first().click();
  await expect(page.getByTestId('bind-visible').locator('option', { hasText: 'menu' })).toHaveCount(
    1,
  );
});

test('an incomplete rule cannot be applied', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openDock(page);
  await page.getByTestId('dock-tab-rules').click();
  await page.getByTestId('rule-add-column').click();

  await expect(page.getByTestId('rule-apply')).toBeDisabled();
  await expect(page.getByTestId('rule-builder')).toContainText('needs a name');
});

test('a saved query is listed and loads back into the console', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openDock(page);
  await page.getByTestId('dock-tab-sql').click();

  await page.getByTestId('sql-input').fill('SELECT first_name FROM guests');
  await page.getByTestId('sql-save-name').fill('Names only');
  await page.getByTestId('sql-save').click();
  await expect(page.getByTestId('sql-saved')).toContainText('Names only', { timeout: 20_000 });

  await page.getByTestId('sql-input').fill('');
  await page
    .getByTestId('sql-saved')
    .getByRole('button', { name: 'Names only', exact: true })
    .click();
  await expect(page.getByTestId('sql-input')).toHaveValue('SELECT first_name FROM guests');

  await page.getByRole('button', { name: 'Remove Names only' }).click();
  await expect(page.getByTestId('sql-saved')).toHaveCount(0);
});
