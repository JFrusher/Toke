import { expect, type Page, test } from '@playwright/test';

/**
 * INC-1 — rulers in the active display unit with a live cursor indicator.
 *
 * Tick arithmetic is proved exhaustively in `engine/canvas/ruler.test.ts`;
 * these assert the rulers are wired to the viewport, the unit and the pointer.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

test('both rulers render', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('ruler-horizontal')).toBeVisible();
  await expect(page.getByTestId('ruler-vertical')).toBeVisible();
});

test('rulers follow the display unit', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('ruler-horizontal')).toHaveAttribute('data-unit', 'mm');

  await page.getByTestId('display-unit').selectOption('in');
  await expect(page.getByTestId('ruler-horizontal')).toHaveAttribute('data-unit', 'in');
  await expect(page.getByTestId('ruler-horizontal')).toHaveAccessibleName(/inches|in/);
});

test('the cursor indicator tracks the pointer and clears on leave', async ({ page }) => {
  await ready(page);

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  // Presence, not visibility: a 1px SVG line has a zero-width bounding box,
  // which Playwright reports as hidden.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('ruler-cursor-x')).toHaveCount(1);
  await expect(page.getByTestId('ruler-cursor-y')).toHaveCount(1);

  const first = await page.getByTestId('ruler-cursor-x').getAttribute('x1');

  // Moving right must move the indicator right — a static line would pass a
  // presence check while telling the user nothing.
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
  await expect
    .poll(async () => Number(await page.getByTestId('ruler-cursor-x').getAttribute('x1')))
    .toBeGreaterThan(Number(first) + 100);

  // A stale indicator pointing at where the mouse used to be is worse than
  // none, so it goes when the pointer leaves the canvas.
  await page.mouse.move(box.x - 60, box.y + box.height / 2);
  await expect(page.getByTestId('ruler-cursor-x')).toHaveCount(0);
});

test('ticks stay legible across the zoom range', async ({ page }) => {
  await ready(page);

  const labels = () => page.getByTestId('ruler-horizontal').locator('text').count();

  const zoomedOut: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.getByLabel('Zoom out').click();
    zoomedOut.push(await labels());
  }

  // Adaptive subdivision means the count stays bounded rather than multiplying
  // as the visible area grows.
  for (const count of zoomedOut) {
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(60);
  }
});

test('rulers do not cover the artboard', async ({ page }) => {
  await ready(page);

  // The drawing area is inset by the rulers, not overlaid: an object hidden
  // under a ruler could not be clicked.
  const ruler = await page.getByTestId('ruler-vertical').boundingBox();
  const viewport = await page.getByTestId('canvas-viewport').boundingBox();
  if (ruler === null || viewport === null) throw new Error('missing box');

  const canvas = await page.locator('[data-testid="canvas-viewport"] canvas').first().boundingBox();
  if (canvas === null) throw new Error('no canvas');

  expect(canvas.x).toBeGreaterThanOrEqual(ruler.x + ruler.width - 1);
});
