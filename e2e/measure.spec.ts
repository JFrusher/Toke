import { expect, test } from '@playwright/test';

/**
 * P5.3 — the linchpin.
 *
 * IMPLEMENTATION_PLAN.md: "This is the guarantee that auto-fit passing on
 * screen means it fits in the PDF — if it fails, stop and fix it before
 * Phase 6."
 *
 * Canvas auto-fit trusts fontkit's metrics. If the browser draws the same
 * string to a different width, text that fits on screen lands outside the
 * trim on every card in a run — and nobody finds out until the cards arrive.
 */

const TOLERANCE_PT = 0.5;

test('browser and fontkit agree on text width within 0.5pt', async ({ page }) => {
  await page.goto('/dev/measure');

  const summary = page.getByTestId('agreement-summary');
  await expect(summary).toBeVisible({ timeout: 30_000 });

  const total = Number(await summary.getAttribute('data-total'));
  const failures = Number(await summary.getAttribute('data-failures'));
  const worst = Number(await summary.getAttribute('data-worst'));

  // 20 strings x 5 sizes x 3 faces.
  expect(total).toBe(300);
  expect(failures).toBe(0);
  expect(worst).toBeLessThanOrEqual(TOLERANCE_PT);
});

test('the comparison actually ran against the bundled faces', async ({ page }) => {
  // A page that silently fell back to a system font would still "agree" with
  // nothing, so prove the registered faces were found.
  await page.goto('/dev/measure');
  await expect(page.getByTestId('measure-failure')).toHaveCount(0);
  await expect(page.getByTestId('agreement-summary')).toContainText('agree');
});

test('the bundled fonts are served', async ({ page }) => {
  for (const file of [
    '/fonts/plex-sans-400-normal.woff',
    '/fonts/plex-sans-600-normal.woff',
    '/fonts/plex-sans-400-italic.woff',
  ]) {
    const response = await page.request.get(file);
    expect(response.status(), file).toBe(200);
    expect(Number(response.headers()['content-length'] ?? 0)).toBeGreaterThan(1000);
  }
});

test('a placed text object is sized by the measurement service', async ({ page }) => {
  await page.goto('/');
  const viewport = page.getByTestId('canvas-viewport');
  await expect(viewport).toBeVisible({ timeout: 20_000 });
  await expect(viewport).toHaveAttribute('data-fonts-ready', 'true', { timeout: 20_000 });

  await page.getByTestId('tool-text').click();
  const box = await viewport.boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.getByRole('treeitem').getByRole('button').click();

  // "Text" at 18pt in IBM Plex Sans measures 34.236pt = 12.08mm, computed
  // independently from the font file. The factory asks for a 160pt starting
  // box; seeing 56.44mm here would mean measurement never reached the node,
  // and the PDF would be wrong even though the canvas looked right.
  const width = Number(await page.getByTestId('field-w').inputValue());
  expect(width).toBeCloseTo(12.08, 1);
});
