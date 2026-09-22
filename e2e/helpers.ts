import type { Page } from '@playwright/test';

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
