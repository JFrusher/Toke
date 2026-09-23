import { expect, type Page, test } from '@playwright/test';

/**
 * Exercises the canvas in a real browser. Fabric needs a canvas context that
 * jsdom does not provide, so none of this is reachable from the unit tests.
 */

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  // Fabric renders a lower/upper canvas pair; target the main surface.
  await expect(page.locator('canvas[data-fabric="main"]')).toBeVisible();
}

/** Place an object by picking a tool and clicking the artboard. */
async function place(page: Page, tool: string, offset = { x: 0, y: 0 }) {
  await page.getByTestId(`tool-${tool}`).click();
  const viewport = page.getByTestId('canvas-viewport');
  const box = await viewport.boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
}

test('boots Fabric and fits the artboard', async ({ page }) => {
  await ready(page);
  // zoomToFit runs on mount, so the zoom is never left at the raw default.
  await expect(page.getByTestId('zoom-level')).not.toHaveText('100%');
});

test('places an object and lists it in the layers tree', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('tree')).toHaveCount(0);

  await place(page, 'rect');

  await expect(page.getByRole('tree', { name: 'Layers' })).toBeVisible();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem')).toContainText('Rectangle');
});

test('returns to the select tool after placing', async ({ page }) => {
  await ready(page);
  await place(page, 'ellipse');
  // Otherwise every subsequent click litters the artboard with ellipses.
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
});

test('places each tool type', async ({ page }) => {
  await ready(page);
  for (const [index, tool] of ['rect', 'ellipse', 'line', 'text'].entries()) {
    await place(page, tool, { x: index * 10, y: index * 10 });
  }
  await expect(page.getByRole('treeitem')).toHaveCount(4);
});

test('selecting a layer populates the numeric fields', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');

  await page.getByRole('treeitem').getByRole('button').first().click();

  const width = page.getByTestId('field-w');
  await expect(width).toBeEnabled();
  // 120pt is 42.33mm — proves Points are converted for display, not shown raw.
  await expect(width).toHaveValue('42.33');
});

test('editing a numeric field moves the object', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  const x = page.getByTestId('field-x');
  await x.click();
  await x.fill('10');
  await x.press('Enter');

  await expect(x).toHaveValue('10');
});

test('a unit suffix is accepted in a numeric field', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  const width = page.getByTestId('field-w');
  await width.click();
  await width.fill('1in');
  await width.press('Enter');

  // 1in = 25.4mm.
  await expect(width).toHaveValue('25.4');
});

test('undo and redo a placement', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await place(page, 'rect');
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  await page.getByTestId('undo').click();
  await expect(page.getByRole('treeitem')).toHaveCount(0);

  await page.getByTestId('redo').click();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
});

test('Ctrl+Z undoes from the keyboard', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('Delete removes the selection', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  await page.keyboard.press('Delete');
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('arrow keys nudge the selection', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  const x = page.getByTestId('field-x');
  const before = Number(await x.inputValue());

  await page.getByTestId('canvas-viewport').click({ position: { x: 4, y: 4 } });
  await page.getByRole('treeitem').getByRole('button').first().click();
  await page.keyboard.press('ArrowRight');

  // 1pt right = 0.35mm.
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(before + 0.35, 1);
});

test('a tool shortcut does not fire while typing in a field', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  // "r" is the rectangle shortcut. Typing it into a numeric field must not
  // switch tools.
  const x = page.getByTestId('field-x');
  await x.click();
  await page.keyboard.type('r');

  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
});

test('grouping keeps both objects on the canvas — DEF-1 regression', async ({ page }) => {
  // The original P3 test only checked the layers tree, so it passed while
  // grouped children were being dropped from the canvas entirely.
  await ready(page);
  const viewport = page.getByTestId('canvas-viewport');

  await place(page, 'rect', { x: -40, y: -20 });
  await place(page, 'ellipse', { x: 40, y: 20 });
  await expect(viewport).toHaveAttribute('data-fabric-objects', '2');

  const items = page.getByRole('treeitem');
  await items.nth(0).getByRole('button').first().click();
  await items
    .nth(1)
    .getByRole('button')
    .first()
    .click({ modifiers: ['Shift'] });
  await page.getByTestId('group').click();

  // Still two drawable objects; the group itself draws nothing.
  await expect(viewport).toHaveAttribute('data-fabric-objects', '2');

  await page.getByRole('button', { name: 'Ungroup' }).click();
  await expect(viewport).toHaveAttribute('data-fabric-objects', '2');
});

test('placing objects adds them to the Fabric canvas, not just the tree', async ({ page }) => {
  await ready(page);
  const viewport = page.getByTestId('canvas-viewport');
  await expect(viewport).toHaveAttribute('data-fabric-objects', '0');

  await place(page, 'rect');
  await expect(viewport).toHaveAttribute('data-fabric-objects', '1');

  await page.getByTestId('undo').click();
  await expect(viewport).toHaveAttribute('data-fabric-objects', '0');
});

test('grouping two objects nests them in the tree', async ({ page }) => {
  await ready(page);
  await place(page, 'rect', { x: -40, y: -20 });
  await place(page, 'ellipse', { x: 40, y: 20 });

  const items = page.getByRole('treeitem');
  await items.nth(0).getByRole('button').first().click();
  await items
    .nth(1)
    .getByRole('button')
    .first()
    .click({ modifiers: ['Shift'] });

  await page.getByTestId('group').click();

  // Group plus its two children.
  await expect(page.getByRole('treeitem')).toHaveCount(3);
  await expect(page.getByRole('treeitem').first()).toContainText('Group');
});

test('zoom controls change the level without moving geometry', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await page.getByRole('treeitem').getByRole('button').first().click();

  const width = page.getByTestId('field-w');
  const before = await width.inputValue();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByTestId('zoom-level')).not.toHaveText('100%');

  // Zoom is a view transform; the document size in mm must not change.
  await expect(width).toHaveValue(before);
});
