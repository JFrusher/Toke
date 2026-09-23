import { expect, type Page, test } from '@playwright/test';

/**
 * The Fabric canvas must keep working when it is rebuilt.
 *
 * VER-1 asks that the canvas mount and unmount without leaking. The rebuild
 * that actually happens in use is a change of artboard size — opening the
 * tent-fold template (85 × 110mm) after the flat one (85 × 55mm) — so both
 * halves are proved here: nothing leaks, and nothing is left unattached.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

async function loadTemplate(page: Page, id: string) {
  await page.getByTestId('open-templates').click();
  await page.getByTestId(`template-${id}`).click();
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 20_000 });
}

async function clickCentre(page: Page) {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('selection still works on the canvas after a change of artboard size', async ({ page }) => {
  await ready(page);
  await loadTemplate(page, 'place-card-tent');

  await clickCentre(page);
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
});

test('VER-1: 50 mount/unmount cycles leak no listeners or canvases', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);

  // Chrome's own view of what is attached — the app cannot miscount itself.
  const cdp = await page.context().newCDPSession(page);
  async function listeners(expression: 'window' | 'document') {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    if (result.objectId === undefined) throw new Error(`no handle on ${expression}`);
    const found = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return found.listeners.length;
  }

  async function cycle() {
    // Below 1024px the studio is replaced outright, so this unmounts the whole
    // shell — canvas, rulers, keyboard handlers — and mounts it again.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByTestId('canvas-viewport')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
  }

  // One cycle first, so anything registered once per page lifetime (lazy
  // module init, a first font load) is in the baseline rather than the delta.
  await cycle();
  const before = {
    window: await listeners('window'),
    document: await listeners('document'),
    canvases: await page.locator('canvas').count(),
  };

  for (let i = 0; i < 50; i += 1) await cycle();

  expect({
    window: await listeners('window'),
    document: await listeners('document'),
    canvases: await page.locator('canvas').count(),
  }).toEqual(before);
});
