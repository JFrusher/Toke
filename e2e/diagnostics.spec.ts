import { expect, type Page, test } from '@playwright/test';
import { importCsv } from './helpers';

/**
 * The diagnostics panel: nothing fails silently.
 *
 * CLAUDE.md §3 forbids swallowing an error. These assert the consequence —
 * that a failure raised anywhere reaches one list the user can find after the
 * surface that produced it has closed.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Grace,Hopper'].join('\n');

/**
 * Places a text object and binds it to a column that does not exist.
 *
 * Records first: with no record source there is no row to resolve against, so
 * the token engine has nothing to fail on and reports nothing.
 */
async function bindUnknownColumn(page: Page) {
  await importCsv(page, GUESTS);
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('treeitem').getByRole('button').first().click();

  await page.getByTestId('binding-text').fill('{{ nope }}');
  await page.getByTestId('binding-text').blur();
  await page.getByTestId('mode-live').click();
}

async function openDiagnostics(page: Page) {
  await page.getByTestId('open-diagnostics').click();
  await expect(page.getByTestId('dock-tab-diagnostics')).toHaveAttribute('aria-selected', 'true');
}

test('starts with nothing to report', async ({ page }) => {
  await ready(page);
  await openDiagnostics(page);
  await expect(page.getByTestId('diagnostics-empty')).toContainText('Nothing to report');
});

test('an unresolved token is reported and selects its object', async ({ page }) => {
  await ready(page);

  // Bind a text object to a column that does not exist, then look at it in
  // Live Mode: the canvas falls back to the template, so without diagnostics
  // the only signal is a card that silently prints "{{ nope }}".
  await bindUnknownColumn(page);

  await openDiagnostics(page);

  const entry = page.getByTestId('diagnostics-entry').first();
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await expect(entry).toHaveAttribute('data-code', 'TOKEN_UNKNOWN_COLUMN');

  // The objectId is the whole reason AppError carries one.
  const objectId = await entry.getAttribute('data-object');
  expect(objectId).not.toBe('');

  await entry.click();
  // Clicking the finding selects the offending object, so the inspector
  // fields come alive on it.
  await expect(page.getByTestId('field-x')).toBeEnabled();
});

test('repeated reports of one finding collapse into a count', async ({ page }) => {
  await ready(page);

  await bindUnknownColumn(page);
  await page.getByTestId('mode-token').click();
  await page.getByTestId('mode-live').click();

  await openDiagnostics(page);

  // One finding, however many times the canvas re-rendered it. A 500-record
  // run must not push half a million entries into memory to say one thing.
  await expect(page.getByTestId('diagnostics-entry')).toHaveCount(1);
});

test('a failed import is reported after the dialog closes', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('', 'utf8'),
  });

  // Scoped to the dialog: Next ships a route announcer with role="alert".
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  await openDiagnostics(page);
  // The point of a central log: the modal's own message is gone.
  await expect(page.getByTestId('diagnostics-entry')).toHaveCount(1);
});

test('the severity filter narrows the list', async ({ page }) => {
  await ready(page);

  await bindUnknownColumn(page);

  await openDiagnostics(page);
  await expect(page.getByTestId('diagnostics-entry')).toHaveCount(1);

  await page.getByTestId('diagnostics-filter-info').click();
  await expect(page.getByTestId('diagnostics-empty')).toBeVisible();

  await page.getByTestId('diagnostics-filter-all').click();
  await expect(page.getByTestId('diagnostics-entry')).toHaveCount(1);
});

test('clearing empties the list', async ({ page }) => {
  await ready(page);

  await bindUnknownColumn(page);

  await openDiagnostics(page);
  await page.getByTestId('diagnostics-clear').click();

  await expect(page.getByTestId('diagnostics-empty')).toBeVisible();
  await expect(page.getByTestId('diagnostics-clear')).toBeDisabled();
});

test('dock tabs are operable with arrow keys', async ({ page }) => {
  await ready(page);
  await openDiagnostics(page);

  await page.getByTestId('dock-tab-diagnostics').focus();
  await page.keyboard.press('ArrowLeft');
  // Data, SQL, Diagnostics — one step left of Diagnostics is SQL.
  await expect(page.getByTestId('dock-tab-sql')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('dock-tab-sql')).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('dock-tab-data')).toHaveAttribute('aria-selected', 'true');
});
