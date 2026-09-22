import { expect, type Page } from '@playwright/test';

/**
 * Shared steps for the studio shell.
 *
 * Panel visibility persists to localStorage (P9.1), so a bare click on a
 * toggle is no longer a reliable way to *open* something — after a reload it
 * may close what a previous step opened. These read the pressed state first.
 */

async function ensurePressed(page: Page, testId: string, pressed: boolean) {
  const button = page.getByTestId(testId);
  const current = (await button.getAttribute('aria-pressed')) === 'true';
  if (current !== pressed) await button.click();
}

/** Opens the bottom dock whether or not it was already showing. */
export function openDock(page: Page) {
  return ensurePressed(page, 'toggle-data', true);
}

/** Closes the bottom dock whether or not it was already hidden. */
export function closeDock(page: Page) {
  return ensurePressed(page, 'toggle-data', false);
}

/**
 * Imports a CSV through the real dialog.
 *
 * The budget is deliberately generous: each spec boots its own SQLite WASM
 * worker, and with parallel workers on a loaded machine an import that takes
 * under a second in isolation can take tens of seconds. A tight timeout here
 * fails tests for machine load rather than for anything in the product.
 */
export async function importCsv(page: Page, csv: string, name = 'guests.csv') {
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 45_000 });
}
