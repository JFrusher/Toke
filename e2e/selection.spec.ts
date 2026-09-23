import { expect, type Page, test } from '@playwright/test';

/**
 * VER-3 and VER-4 — marquee selection and multi-select resize.
 *
 * Both are Fabric behaviour (`ActiveSelection`), but what reaches the store is
 * ours: `commitFromFabric` has to decompose the group transform back into each
 * node. Neither had ever been asserted.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

const fieldValue = async (page: Page, field: string) =>
  Number((await page.getByTestId(field).inputValue()).replace(/[^\d.-]/g, ''));

async function geometry(page: Page, index: number) {
  await page.getByRole('treeitem').nth(index).locator('button').first().click();
  return {
    x: await fieldValue(page, 'field-x'),
    y: await fieldValue(page, 'field-y'),
    w: await fieldValue(page, 'field-w'),
    h: await fieldValue(page, 'field-h'),
  };
}

/** Two 120 × 60pt rectangles, top-left at the click. Returns screen geometry. */
async function twoRects(page: Page) {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  const zoom = Number((await page.getByTestId('zoom-level').textContent())?.replace('%', '')) / 100;

  const a = { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 - 80 };
  const b = { x: a.x + 180, y: a.y + 100 };
  for (const at of [a, b]) {
    await page.getByTestId('tool-rect').click();
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Escape');

  return { box, a, b, width: 120 * zoom, height: 60 * zoom };
}

async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

const selected = (page: Page) => page.locator('[role="treeitem"][aria-selected="true"]');

test('VER-4: a marquee around two objects selects both', async ({ page }) => {
  await ready(page);
  const { a, b, width, height } = await twoRects(page);
  await expect(selected(page)).toHaveCount(0);

  await marquee(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + width + 20, y: b.y + height + 20 });

  await expect(selected(page)).toHaveCount(2);
});

test('VER-4: a marquee over empty pasteboard selects nothing', async ({ page }) => {
  await ready(page);
  const { a } = await twoRects(page);

  // Above and left of both rectangles, touching neither.
  await marquee(page, { x: a.x - 80, y: a.y - 70 }, { x: a.x - 20, y: a.y - 20 });

  await expect(selected(page)).toHaveCount(0);
});

test('VER-3: resizing a multi-selection scales every member about the fixed corner', async ({
  page,
}) => {
  await ready(page);
  const { a, b, width, height } = await twoRects(page);

  // Tree order is front-to-back: the second rectangle drawn is on top.
  const beforeA = await geometry(page, 1);
  const beforeB = await geometry(page, 0);
  await page.keyboard.press('Escape');

  await marquee(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + width + 20, y: b.y + height + 20 });
  await expect(selected(page)).toHaveCount(2);

  // Drag the selection's bottom-right handle out by half its size again.
  const corner = { x: b.x + width, y: b.y + height };
  const grow = { x: (corner.x - a.x) / 2, y: (corner.y - a.y) / 2 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + grow.x, corner.y + grow.y, { steps: 10 });
  await page.mouse.up();

  const afterA = await geometry(page, 1);
  const afterB = await geometry(page, 0);

  const scaleX = afterA.w / beforeA.w;
  const scaleY = afterA.h / beforeA.h;
  expect(scaleX).toBeGreaterThan(1.3);
  expect(scaleY).toBeGreaterThan(1.3);

  // The origin is the opposite corner: the top-left member does not move.
  expect(afterA.x).toBeCloseTo(beforeA.x, 0);
  expect(afterA.y).toBeCloseTo(beforeA.y, 0);

  // Proportional: every member and every gap scales by the same factor.
  const close = (actual: number, expected: number) =>
    expect(Math.abs(actual / expected - 1)).toBeLessThan(0.03);
  close(afterB.w / beforeB.w, scaleX);
  close(afterB.h / beforeB.h, scaleY);
  close((afterB.x - afterA.x) / (beforeB.x - beforeA.x), scaleX);
  close((afterB.y - afterA.y) / (beforeB.y - beforeA.y), scaleY);
});

test('moving a multi-selection moves every member by the same distance', async ({ page }) => {
  // The same defect as VER-3 in its commonest form: members of a selection
  // were committed with coordinates relative to the selection, so a drag of
  // two objects threw both across the artboard.
  await ready(page);
  const { a, b, width, height } = await twoRects(page);
  const beforeA = await geometry(page, 1);
  const beforeB = await geometry(page, 0);
  await page.keyboard.press('Escape');

  await marquee(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + width + 20, y: b.y + height + 20 });
  await page.mouse.move(a.x + 10, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 70, a.y + 40, { steps: 8 });
  await page.mouse.up();

  const afterA = await geometry(page, 1);
  const afterB = await geometry(page, 0);

  expect(afterA.x - beforeA.x).toBeGreaterThan(1);
  expect(afterB.x - beforeB.x).toBeCloseTo(afterA.x - beforeA.x, 1);
  expect(afterB.y - beforeB.y).toBeCloseTo(afterA.y - beforeA.y, 1);
  expect(afterA.w).toBeCloseTo(beforeA.w, 1);
});
