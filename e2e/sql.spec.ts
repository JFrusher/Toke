import { expect, type Page, test } from '@playwright/test';
import { importCsv } from './helpers';

/**
 * The SQL console: find the right SELECT, then make it the record source.
 */

const GUESTS = [
  'first_name,last_name,rsvp_status',
  'Ada,Lovelace,Accepted',
  'Grace,Hopper,Accepted',
  'Alan,Turing,Declined',
].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
}

async function openConsole(page: Page) {
  await page.getByTestId('toggle-data').click();
  await page.getByTestId('dock-tab-sql').click();
  await expect(page.getByTestId('sql-input')).toBeVisible();
}

test('runs a query and shows the rows', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill('SELECT first_name FROM guests ORDER BY first_name');
  await page.getByTestId('sql-run').click();

  const table = page.getByTestId('sql-results');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table).toContainText('Ada');
  await expect(table).toContainText('Grace');
});

test('Ctrl+Enter executes without reaching for the mouse', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill('SELECT last_name FROM guests');
  await page.getByTestId('sql-input').press('Control+Enter');

  await expect(page.getByTestId('sql-results')).toContainText('Turing', { timeout: 20_000 });
});

test('shows the SQLite message verbatim', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill('SELECT frist_name FROM guests');
  await page.getByTestId('sql-run').click();

  // "no such column: frist_name" says exactly what to fix; a friendlier
  // paraphrase would say less.
  await expect(page.getByTestId('sql-error')).toContainText('frist_name', { timeout: 20_000 });
});

test('refuses a statement that would modify the data', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  // There is no undo for the database — the command stack covers the canvas.
  await page.getByTestId('sql-input').fill('DELETE FROM guests');
  await page.getByTestId('sql-run').click();

  await expect(page.getByTestId('sql-error')).toBeVisible();
  await expect(page.getByTestId('sql-results')).toHaveCount(0);
});

test('a query with no rows says so rather than showing an empty table', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill("SELECT * FROM guests WHERE first_name = 'Nobody'");
  await page.getByTestId('sql-run').click();

  await expect(page.getByTestId('sql-empty')).toBeVisible({ timeout: 20_000 });
});

test('history recalls a previous query', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill('SELECT last_name FROM guests');
  await page.getByTestId('sql-run').click();
  await expect(page.getByTestId('sql-results')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('sql-input').fill('SELECT 1');
  await page.getByTestId('sql-run').click();

  await page.getByTestId('sql-history').getByText('SELECT last_name FROM guests').click();
  await expect(page.getByTestId('sql-input')).toHaveValue('SELECT last_name FROM guests');
});

test('sets the query as the record source and the print run follows', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  // Three guests, two accepted: the record source is what decides how many
  // cards get printed.
  await page.getByTestId('sql-input').fill("SELECT * FROM guests WHERE rsvp_status = 'Accepted'");
  await page.getByTestId('sql-run').click();
  await expect(page.getByTestId('sql-results')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('sql-use-as-source').click();

  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 2', { timeout: 20_000 });
});

test('the console refuses to re-set a query that is already the source', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await openConsole(page);

  await page.getByTestId('sql-input').fill("SELECT * FROM guests WHERE rsvp_status = 'Accepted'");
  await page.getByTestId('sql-use-as-source').click();

  await expect(page.getByTestId('sql-use-as-source')).toBeDisabled();
  await expect(page.getByTestId('sql-use-as-source')).toContainText('Is the record source');
});
