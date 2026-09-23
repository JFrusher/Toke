import { expect, type Page, test } from '@playwright/test';

/**
 * VER-5 and INC-35 — the inspector during a live gesture, and aspect lock.
 *
 * VER-5's criterion was "values update live during canvas drag without
 * fighting user input mid-edit". The second half held; the first did not —
 * fields only updated when the drag ended.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function placeRect(page: Page, at: { x: number; y: number }) {
  await page.getByTestId('tool-rect').click();
  await page.mouse.click(at.x, at.y);
}

const fieldValue = async (page: Page, field: string) =>
  Number((await page.getByTestId(field).inputValue()).replace(/[^\d.-]/g, ''));

test('the transform fields track a drag while it happens', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 300, y: box.y + 260 });
  const before = await fieldValue(page, 'field-x');

  await page.mouse.move(box.x + 320, box.y + 280);
  await page.mouse.down();
  await page.mouse.move(box.x + 440, box.y + 280, { steps: 8 });

  // Still holding the mouse down: the criterion is that this updates DURING
  // the drag, not when it ends.
  await expect.poll(() => fieldValue(page, 'field-x')).toBeGreaterThan(before + 10);

  await page.mouse.up();
});

test('the committed value matches what the drag showed', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 300, y: box.y + 260 });

  await page.mouse.move(box.x + 320, box.y + 280);
  await page.mouse.down();
  await page.mouse.move(box.x + 440, box.y + 280, { steps: 8 });
  const during = await fieldValue(page, 'field-x');
  await page.mouse.up();

  // A live readout that disagrees with the committed node would be worse than
  // no readout at all.
  await expect.poll(() => fieldValue(page, 'field-x')).toBeCloseTo(during, 1);
});

test('a drag is still one undo despite the live updates', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 300, y: box.y + 260 });
  const before = await fieldValue(page, 'field-x');

  await page.mouse.move(box.x + 320, box.y + 280);
  await page.mouse.down();
  await page.mouse.move(box.x + 440, box.y + 280, { steps: 12 });
  await page.mouse.up();

  // The live readout must not push a command per mousemove.
  await page.getByTestId('undo').click();
  await expect.poll(() => fieldValue(page, 'field-x')).toBeCloseTo(before, 1);
});

test('typing in a field is not overwritten by the canvas', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 300, y: box.y + 260 });

  // The other half of the criterion, which already held: a draft survives
  // while focused.
  await page.getByTestId('field-x').click();
  await page.getByTestId('field-x').fill('42');
  await expect(page.getByTestId('field-x')).toHaveValue('42');

  await page.getByTestId('field-x').blur();
  await expect.poll(() => fieldValue(page, 'field-x')).toBeCloseTo(42, 1);
});

test('Shift locks the aspect ratio while resizing', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 300, y: box.y + 260 });
  await page.getByTestId('field-w').fill('40');
  await page.getByTestId('field-w').blur();
  await page.getByTestId('field-h').fill('20');
  await page.getByTestId('field-h').blur();

  const ratio = (await fieldValue(page, 'field-w')) / (await fieldValue(page, 'field-h'));

  // Grab the bottom-right handle. The object starts at the placement point,
  // so the handle sits at placement + size on screen.
  const w = await fieldValue(page, 'field-w');
  const h = await fieldValue(page, 'field-h');
  const zoom =
    Number.parseInt(
      ((await page.getByTestId('zoom-level').textContent()) ?? '100%').replace('%', ''),
      10,
    ) / 100;
  const mmToPt = 2.834645669;
  const corner = {
    x: box.x + 300 + w * mmToPt * zoom,
    y: box.y + 260 + h * mmToPt * zoom,
  };

  await page.keyboard.down('Shift');
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 90, corner.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const after = (await fieldValue(page, 'field-w')) / (await fieldValue(page, 'field-h'));
  expect(after).toBeCloseTo(ratio, 1);
});
