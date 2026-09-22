import { expect, type Page, test } from '@playwright/test';

/**
 * DEF-2 — text typed into Fabric's own editor must reach the scene node.
 *
 * The scene node is what the PDF reads, so an edit that stops at the Fabric
 * object would print the old string on every card while the screen shows the
 * new one. Nothing covered this path before.
 *
 * Fabric enters editing on a click against an ALREADY-SELECTED text object,
 * not on double-click.
 */

/**
 * Screen offset from the placement point into the object's body.
 *
 * A text object is placed with its top-left at the click, so clicking the same
 * point again lands on the top-left resize handle rather than the text — the
 * object never sees a mousedown and never enters editing. The default box is
 * roughly 34 x 22pt and the artboard sits near 3x zoom, so this offset is
 * comfortably inside it.
 */
const INTO_BODY = { x: 40, y: 26 };

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

/** Places a text object and returns the point that was clicked to place it. */
async function placeText(page: Page) {
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  return at;
}

/** Types into Fabric's editor and clicks the pasteboard to commit. */
async function editInPlace(page: Page, at: { x: number; y: number }, text: string) {
  await page.mouse.click(at.x + INTO_BODY.x, at.y + INTO_BODY.y);
  // Fabric mounts its own textarea on entering edit mode; waiting for it is
  // what keeps the keystrokes below out of the global shortcut handler.
  await page.waitForSelector('textarea[data-fabric="textarea"]', { timeout: 10_000 });

  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + 12, box.y + 12);
  await expect(page.locator('textarea[data-fabric="textarea"]')).toHaveCount(0);
}

test('clicking a selected text object enters the editor', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  await page.mouse.click(at.x + INTO_BODY.x, at.y + INTO_BODY.y);
  await expect(page.locator('textarea[data-fabric="textarea"]')).toHaveCount(1);
});

test('text typed on the canvas reaches the scene node', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  await editInPlace(page, at, 'Ada Lovelace');

  // The binding field reads node.text — the same string the PDF renderer
  // resolves. Reading the Fabric object instead would prove nothing.
  await page.getByRole('treeitem').getByRole('button').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Ada Lovelace');
});

test('a canvas text edit survives undo and redo', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  await editInPlace(page, at, 'Grace Hopper');
  await page.getByRole('treeitem').getByRole('button').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Grace Hopper');

  // One undo takes back the edit, not the placement: an edit that never
  // reached the history stack would remove the object instead.
  await page.getByTestId('undo').click();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByTestId('binding-text')).not.toHaveValue('Grace Hopper');

  await page.getByTestId('redo').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Grace Hopper');
});

test('typing on the canvas does not fire tool shortcuts', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  // "Rectangle" contains r, e, t and l — every single-key tool shortcut. If
  // the keystrokes leaked to the window handler they would switch tools and
  // the next click would place another object.
  await editInPlace(page, at, 'Rectangle');

  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
  await page.getByRole('treeitem').getByRole('button').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Rectangle');
});
