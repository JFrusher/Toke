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
 * The default text box, in points, as `measureText` sizes the word "Text".
 *
 * A text object is placed with its top-left at the click, so clicking that
 * same point again lands on the top-left resize handle: the object never sees
 * a mousedown and never enters editing. The click has to go into the body.
 */
const DEFAULT_BOX_PT = { width: 34, height: 21 };

/** Current zoom, read from the toolbar rather than assumed. */
async function zoomOf(page: Page): Promise<number> {
  const label = (await page.getByTestId('zoom-level').textContent()) ?? '100%';
  return Number.parseInt(label.replace('%', ''), 10) / 100;
}

/**
 * Screen offset from the placement point into the object's body.
 *
 * Derived from the zoom, not fixed: the fit zoom changes whenever the viewport
 * geometry does — adding rulers moved it — and a hardcoded pixel offset then
 * lands outside the object and silently stops testing anything.
 */
async function intoBody(page: Page) {
  const zoom = await zoomOf(page);
  return { x: (DEFAULT_BOX_PT.width / 2) * zoom, y: (DEFAULT_BOX_PT.height / 2) * zoom };
}

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
  const offset = await intoBody(page);
  await page.mouse.click(at.x + offset.x, at.y + offset.y);
  // Fabric mounts its own textarea on entering edit mode; waiting for it is
  // what keeps the keystrokes below out of the global shortcut handler.
  await page.waitForSelector('textarea[data-fabric="textarea"]', { timeout: 10_000 });

  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);

  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  // Clear of the rulers, which occupy the first 20px of each edge and swallow
  // the click before Fabric can see the mouseup that exits editing.
  await page.mouse.click(box.x + 60, box.y + 60);
  await expect(page.locator('textarea[data-fabric="textarea"]')).toHaveCount(0);
}

test('clicking a selected text object enters the editor', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  const offset = await intoBody(page);
  await page.mouse.click(at.x + offset.x, at.y + offset.y);
  await expect(page.locator('textarea[data-fabric="textarea"]')).toHaveCount(1);
});

test('text typed on the canvas reaches the scene node', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  await editInPlace(page, at, 'Ada Lovelace');

  // The binding field reads node.text — the same string the PDF renderer
  // resolves. Reading the Fabric object instead would prove nothing.
  await page.getByRole('treeitem').getByRole('button').first().click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Ada Lovelace');
});

test('a canvas text edit survives undo and redo', async ({ page }) => {
  await ready(page);
  const at = await placeText(page);

  await editInPlace(page, at, 'Grace Hopper');
  await page.getByRole('treeitem').getByRole('button').first().click();
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
  await page.getByRole('treeitem').getByRole('button').first().click();
  await expect(page.getByTestId('binding-text')).toHaveValue('Rectangle');
});
