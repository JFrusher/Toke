import { expect, type Page, test } from '@playwright/test';
import { openDock } from './helpers';

/**
 * Panel layout: resizing, collapsing and remembering.
 *
 * Panel sizes live in localStorage, so every test here starts from a known
 * state rather than from whatever the previous one left behind.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
}

function widthOf(page: Page, label: string) {
  return page
    .getByRole('complementary', { name: label })
    .evaluate((element) => element.getBoundingClientRect().width);
}

test('sidebars open at their default widths', async ({ page }) => {
  await ready(page);
  expect(await widthOf(page, 'Layers')).toBeCloseTo(224, 0);
  expect(await widthOf(page, 'Inspector')).toBeCloseTo(240, 0);
});

test('a panel width survives a reload', async ({ page }) => {
  await ready(page);

  const handle = page.getByTestId('resize-layers-width');
  await handle.focus();
  // Four large steps: 224 + 4 x 32 = 352, inside the 160-420 range.
  for (let i = 0; i < 4; i += 1) await handle.press('Shift+ArrowRight');

  await expect(handle).toHaveAttribute('aria-valuenow', '352');

  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  expect(await widthOf(page, 'Layers')).toBeCloseTo(352, 0);
});

test('the splitter is operable from the keyboard alone', async ({ page }) => {
  await ready(page);

  // A splitter that only answers to a drag locks keyboard users out of the
  // panel sizes entirely.
  const handle = page.getByTestId('resize-inspector-width');
  await handle.focus();
  await expect(handle).toBeFocused();

  await handle.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '200');
  await handle.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
});

test('a splitter clamps at its limits rather than collapsing the canvas', async ({ page }) => {
  await ready(page);

  const handle = page.getByTestId('resize-layers-width');
  await handle.focus();
  for (let i = 0; i < 20; i += 1) await handle.press('Shift+ArrowRight');

  await expect(handle).toHaveAttribute('aria-valuenow', '420');
});

test('collapsing a panel gives its width to the canvas', async ({ page }) => {
  await ready(page);

  const canvas = page.getByTestId('canvas-viewport');
  const before = (await canvas.boundingBox())?.width ?? 0;

  await page.getByTestId('toggle-left').click();
  await expect(page.getByTestId('toggle-left')).toHaveAttribute('aria-pressed', 'false');

  const after = (await canvas.boundingBox())?.width ?? 0;
  // The 224px sidebar plus its 1px handle.
  expect(after - before).toBeCloseTo(225, 0);
});

test('a collapsed panel stays collapsed across a reload', async ({ page }) => {
  await ready(page);

  await page.getByTestId('toggle-right').click();
  await page.reload();

  await expect(page.getByTestId('toggle-right')).toHaveAttribute('aria-pressed', 'false', {
    timeout: 20_000,
  });
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);
});

test('the dock height is remembered too', async ({ page }) => {
  await ready(page);
  await openDock(page);

  const handle = page.getByTestId('resize-dock-height');
  await handle.focus();
  await handle.press('Shift+ArrowUp');
  await expect(handle).toHaveAttribute('aria-valuenow', '288');

  await page.reload();
  await expect(page.getByTestId('bottom-dock')).toBeVisible({ timeout: 20_000 });
  const height = await page
    .getByTestId('bottom-dock')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeCloseTo(288, 0);
});

test('arrow keys reach the canvas, not the splitter, when nothing is focused', async ({ page }) => {
  await ready(page);

  // The splitter owns arrow keys while focused; the global nudge handler must
  // not also fire, or a resize would move the selection at the same time.
  const handle = page.getByTestId('resize-layers-width');
  await handle.focus();
  await handle.press('ArrowRight');

  await expect(handle).toHaveAttribute('aria-valuenow', '232');
});

for (const width of [1024, 1440]) {
  test(`the header stays one row at ${width}px, before and after the first edit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);

    const headerHeight = async () =>
      (await page.locator('header').first().boundingBox())?.height ?? 0;
    const canvasTop = async () => (await page.getByTestId('canvas-viewport').boundingBox())?.y ?? 0;

    const before = { header: await headerHeight(), canvas: await canvasTop() };
    // One row of 28px controls plus padding; a wrapped header is ~85px.
    expect(before.header).toBeLessThan(50);

    // The first edit flips "Saved" to "Unsaved". That flip used to wrap the
    // header and drop the whole canvas 40px under the pointer mid-gesture.
    const box = await page.getByTestId('canvas-viewport').boundingBox();
    if (box === null) throw new Error('viewport has no box');
    await page.getByTestId('tool-rect').click();
    await page.mouse.click(box.x + 300, box.y + 300);
    await expect(page.getByTestId('dirty-flag')).toHaveAttribute('data-dirty', 'true');

    expect(await headerHeight()).toBe(before.header);
    expect(await canvasTop()).toBe(before.canvas);
  });
}
