import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * BLK-2 — the pen tool.
 *
 * `PathNode`, the Fabric mapping and the PDF path renderer were all built and
 * nothing could create a path. Geometry is proved in `engine/canvas/pen.test.ts`;
 * these drive the real interaction.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function centre(page: Page) {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('clicking places anchors and Enter finishes an open path', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x - 80, c.y);
  await page.mouse.click(c.x, c.y - 60);
  await page.mouse.click(c.x + 80, c.y);

  // Nothing enters the scene graph until the path is finished.
  await expect(page.getByTestId('pen-preview')).toHaveAttribute('data-anchors', '3');
  await expect(page.getByRole('treeitem')).toHaveCount(0);

  await page.keyboard.press('Enter');

  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem')).toContainText('Path');
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
  // Enter hands back to Select.
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking the first anchor closes the path', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x - 60, c.y + 40);
  await page.mouse.click(c.x, c.y - 40);
  await page.mouse.click(c.x + 60, c.y + 40);
  await page.mouse.click(c.x - 60, c.y + 40);

  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByTestId('pen-preview')).toHaveCount(0);
});

test('dragging from an anchor pulls out a curve handle', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x - 80, c.y);

  // Press, drag, release: a smooth point rather than a corner.
  await page.mouse.move(c.x + 80, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 140, c.y - 50, { steps: 6 });
  await page.mouse.up();

  // The preview draws the handle line either side of the anchor.
  await expect(page.getByTestId('pen-preview').locator('line')).toHaveCount(1);

  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
});

test('Escape abandons the path without adding anything', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x - 40, c.y);
  await page.mouse.click(c.x + 40, c.y);
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('pen-preview')).toHaveCount(0);
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('a single click is discarded rather than kept as an invisible node', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');

  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('the pen clicks through existing objects instead of selecting them', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-rect').click();
  await page.mouse.click(c.x - 20, c.y - 20);
  await page.keyboard.press('Escape');

  await page.getByTestId('tool-pen').click();
  // Both anchors land on top of the rectangle.
  await page.mouse.click(c.x, c.y);
  await page.mouse.click(c.x + 30, c.y + 10);

  await expect(page.getByTestId('pen-preview')).toHaveAttribute('data-anchors', '2');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem')).toHaveCount(2);
});

test('a whole path is one undo', async ({ page }) => {
  await ready(page);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  for (const dx of [-80, -30, 20, 70]) await page.mouse.click(c.x + dx, c.y + (dx % 20));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  await page.getByTestId('undo').click();
  await expect(page.getByRole('treeitem')).toHaveCount(0);
});

test('a drawn path reaches the PDF as vector operators', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await importCsv(page, GUESTS);
  const c = await centre(page);

  await page.getByTestId('tool-pen').click();
  await page.mouse.click(c.x - 60, c.y);
  await page.mouse.move(c.x + 60, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 110, c.y - 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Enter');

  await page.getByTestId('open-export').click();
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('run-proof').click();

  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = await PDFDocument.load(Buffer.concat(chunks));

  // One page, drawn — not a raster. An image XObject here would mean the
  // path had been flattened somewhere on the way.
  expect(pdf.getPageCount()).toBe(1);
  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => String(object));
  expect(objects.some((object) => /\/Subtype\s*\/Image/.test(object))).toBe(false);
});
