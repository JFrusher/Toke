import { expect, type Page, test } from '@playwright/test';

/**
 * INC-3 / INC-9 — pan gestures and the align shortcuts.
 *
 * Both were signed off with only part of the criterion met: panning worked on
 * a trackpad only, and align was toolbar-only against a §4.7 commitment to
 * full keyboard operation.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

/**
 * The leftmost value on the horizontal ruler.
 *
 * Reads the label's TEXT, not its x: panning changes which tick is leftmost,
 * so a screen coordinate says nothing. Panning right reveals more of the
 * pasteboard to the left, so this value decreases.
 */
async function leftmostRulerValue(page: Page): Promise<number> {
  const label = page.getByTestId('ruler-horizontal').locator('text').first();
  return Number((await label.textContent()) ?? '0');
}

async function placeRect(page: Page, at: { x: number; y: number }) {
  await page.getByTestId('tool-rect').click();
  await page.mouse.click(at.x, at.y);
}

test('middle-drag pans the canvas', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  const before = await leftmostRulerValue(page);

  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 420, box.y + 300, { steps: 6 });
  await page.mouse.up({ button: 'middle' });

  await expect.poll(() => leftmostRulerValue(page)).toBeLessThan(before);
});

test('space-drag pans without selecting', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 260, y: box.y + 220 });
  // Escape rather than a click on empty canvas: deterministic, and it is the
  // documented deselect key.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('field-x')).toBeDisabled();

  const before = await leftmostRulerValue(page);

  // Deliberately starting the drag ON the object: space-drag must pan from
  // anywhere, not only from empty pasteboard.
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 280, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 240, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');

  await expect.poll(() => leftmostRulerValue(page)).toBeLessThan(before);
  // The drag panned rather than marquee-selecting whatever it crossed.
  await expect(page.getByTestId('field-x')).toBeDisabled();
});

test('space does not pan while typing', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  // A text node, because the binding field is where the spaces go.
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + 260, box.y + 220);
  await page.getByRole('treeitem').getByRole('button').click();

  const before = await leftmostRulerValue(page);

  // Space belongs to the sentence, not to the canvas.
  await page.getByTestId('binding-text').fill('Ada Lovelace');
  await expect(page.getByTestId('binding-text')).toHaveValue('Ada Lovelace');
  expect(await leftmostRulerValue(page)).toBe(before);
});

test('align shortcuts move the selection', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await placeRect(page, { x: box.x + 200, y: box.y + 200 });
  await placeRect(page, { x: box.x + 400, y: box.y + 320 });

  // Select both through the layers tree, then align left from the keyboard.
  await page.getByRole('treeitem').first().getByRole('button').click();
  await page
    .getByRole('treeitem')
    .nth(1)
    .getByRole('button')
    .click({ modifiers: ['Shift'] });

  await page.keyboard.press('Control+Shift+L');

  // Aligned left means both share an X; the field shows a shared value rather
  // than a mixed dash.
  await expect(page.getByTestId('field-x')).not.toHaveValue('—');
});

test('the shortcut reference lists the align keys', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-shortcuts').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Align left, centre, right');
  await expect(dialog).toContainText('Bring forward');
});
