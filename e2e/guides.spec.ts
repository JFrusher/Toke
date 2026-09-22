import { expect, type Page, test } from '@playwright/test';

/**
 * INC-2 — guides, snap indicators and Ctrl to suspend snapping.
 *
 * The snapping engine, the store field and addGuide were all built and tested
 * in P3.7 and nothing ever called them: the canvas snapped silently and there
 * was no way to create a guide at all.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

/** Drags off a ruler to drop a guide. */
async function dragGuide(page: Page, axis: 'vertical' | 'horizontal', to: number) {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  const from =
    axis === 'vertical' ? { x: box.x + 200, y: box.y + 10 } : { x: box.x + 10, y: box.y + 200 };
  const drop =
    axis === 'vertical' ? { x: box.x + to, y: box.y + 260 } : { x: box.x + 260, y: box.y + to };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
}

test('dragging off the horizontal ruler creates a vertical guide', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '0');

  await dragGuide(page, 'vertical', 300);

  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '1');
  await expect(page.getByTestId('guide-line')).toHaveCount(1);
});

test('dragging off the vertical ruler creates a horizontal guide', async ({ page }) => {
  await ready(page);
  await dragGuide(page, 'horizontal', 320);
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '1');
});

test('guides accumulate and can be removed', async ({ page }) => {
  await ready(page);
  await dragGuide(page, 'vertical', 280);
  await dragGuide(page, 'vertical', 380);
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '2');

  // A 1px line is not a target anyone can hit, so a real button carries the
  // removal — which also makes it reachable from the keyboard.
  await page.getByTestId('guide-hit').first().click();
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '1');
});

test('guides move with the canvas rather than sticking to the screen', async ({ page }) => {
  await ready(page);
  await dragGuide(page, 'vertical', 300);

  const before = Number(await page.getByTestId('guide-line').getAttribute('x1'));

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 600, box.y + 400, { steps: 5 });
  await page.mouse.up({ button: 'middle' });

  // A guide marks a position on the artboard, not on the display.
  await expect
    .poll(async () => Number(await page.getByTestId('guide-line').getAttribute('x1')))
    .toBeGreaterThan(before + 60);
});

test('dragging an object onto a guide draws a snap indicator', async ({ page }) => {
  await ready(page);

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await page.getByTestId('tool-rect').click();
  await page.mouse.click(box.x + 420, box.y + 300);

  // The guide goes exactly where the rect's left edge already sits, so the
  // drag only has to cross it rather than find it: the snap threshold is 4
  // screen pixels and a coarse drag steps straight over it.
  await dragGuide(page, 'vertical', 420);
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-guide-count', '1');

  await page.mouse.move(box.x + 440, box.y + 320);
  await page.mouse.down();

  // Away, then back across the guide a pixel at a time.
  await page.mouse.move(box.x + 470, box.y + 320, { steps: 5 });

  let sawIndicator = false;
  for (let dx = 30; dx >= 0 && !sawIndicator; dx -= 1) {
    await page.mouse.move(box.x + 440 + dx, box.y + 320);
    const count = await page.getByTestId('canvas-guides').getAttribute('data-snap-count');
    if (count !== '0') sawIndicator = true;
  }

  expect(sawIndicator, 'no snap indicator appeared while crossing the guide').toBe(true);

  await page.mouse.up();
  // Indicators belong to the gesture and go with it.
  await expect(page.getByTestId('canvas-guides')).toHaveAttribute('data-snap-count', '0');
});

test('holding Ctrl suspends snapping', async ({ page }) => {
  await ready(page);

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await page.getByTestId('tool-rect').click();
  await page.mouse.click(box.x + 420, box.y + 300);
  await dragGuide(page, 'vertical', 420);

  await page.keyboard.down('Control');
  await page.mouse.move(box.x + 440, box.y + 320);
  await page.mouse.down();
  await page.mouse.move(box.x + 470, box.y + 320, { steps: 5 });

  let sawIndicator = false;
  for (let dx = 30; dx >= 0 && !sawIndicator; dx -= 1) {
    await page.mouse.move(box.x + 440 + dx, box.y + 320);
    const count = await page.getByTestId('canvas-guides').getAttribute('data-snap-count');
    if (count !== '0') sawIndicator = true;
  }

  await page.mouse.up();
  await page.keyboard.up('Control');

  // Ctrl is how you place something a hair off a guide deliberately.
  expect(sawIndicator, 'snapping was not suspended by Ctrl').toBe(false);
});
