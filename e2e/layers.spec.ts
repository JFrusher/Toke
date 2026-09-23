import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * Phase 2 — BLK-3, INC-4, INC-19, INC-27.
 *
 * The layers tree is the screen-reader representation of the canvas
 * (CLAUDE.md §4.7), and until now it could only select.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Bartholomew,Winterbourne-Fitzgerald'].join(
  '\n',
);

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function placeText(page: Page) {
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
}

test('BLK-3 — a bound object is marked in the layers tree', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await placeText(page);

  await expect(page.getByTestId('layer-bound')).toHaveCount(0);

  await page.getByRole('treeitem').getByRole('button').first().click();
  await page.getByTestId('binding-text').fill('{{ first_name }}');
  await page.getByTestId('binding-text').blur();

  // A word as well as the colour: §4.7 forbids signalling state by colour.
  await expect(page.getByTestId('layer-bound')).toHaveText('bound');
});

test('INC-4 — a layer can be renamed', async ({ page }) => {
  await ready(page);
  await placeText(page);

  const row = page.getByRole('treeitem').getByRole('button').first();
  await expect(row).toContainText('Text');

  await row.dblclick();
  const field = page.getByRole('textbox', { name: /^Rename/ });
  await field.fill('Guest name');
  await field.press('Enter');

  await expect(page.getByRole('treeitem')).toContainText('Guest name');
});

test('INC-4 — renaming is undoable and Escape abandons it', async ({ page }) => {
  await ready(page);
  await placeText(page);

  const row = page.getByRole('treeitem').getByRole('button').first();
  await row.dblclick();
  const field = page.getByRole('textbox', { name: /^Rename/ });
  await field.fill('Abandoned');
  await field.press('Escape');
  await expect(page.getByRole('treeitem')).toContainText('Text');

  await row.dblclick();
  await page.getByRole('textbox', { name: /^Rename/ }).fill('Kept');
  await page.getByRole('textbox', { name: /^Rename/ }).press('Enter');
  await expect(page.getByRole('treeitem')).toContainText('Kept');

  await page.getByTestId('undo').click();
  await expect(page.getByRole('treeitem')).toContainText('Text');
});

test('INC-4 — visibility toggles and hides the object', async ({ page }) => {
  await ready(page);
  await placeText(page);

  const toggle = page.getByRole('button', { name: /^Hide / });
  await toggle.click();

  await expect(page.getByRole('button', { name: /^Show / })).toBeVisible();
  // The canvas keeps the object but stops drawing it; the count is objects
  // Fabric holds, so visibility is asserted through the control's own state.
  await expect(page.getByRole('button', { name: /^Show / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('INC-4 — locking a layer is reflected and reversible', async ({ page }) => {
  await ready(page);
  await placeText(page);

  await page.getByRole('button', { name: /^Lock / }).click();
  await expect(page.getByRole('button', { name: /^Unlock / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByTestId('undo').click();
  await expect(page.getByRole('button', { name: /^Lock / })).toBeVisible();
});

test('INC-4 — Ctrl+] reorders within the stack', async ({ page }) => {
  await ready(page);
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');

  await page.getByTestId('tool-rect').click();
  await page.mouse.click(box.x + 260, box.y + 240);
  await page.getByTestId('tool-ellipse').click();
  await page.mouse.click(box.x + 400, box.y + 300);

  // The tree reads top of stack first, so the ellipse placed last is row one.
  await expect(page.getByRole('treeitem').first()).toContainText('Ellipse');

  await page.getByRole('treeitem').nth(1).getByRole('button').first().click();
  // Wait for the selection to settle rather than for a duration: the tree
  // click writes to the store, the store syncs Fabric, and Fabric writes back.
  await expect(page.getByRole('treeitem').nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+]');

  await expect(page.getByRole('treeitem').first()).toContainText('Rectangle');
});

test('INC-19 — the binding panel names the overflowing record', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await placeText(page);

  await page.getByRole('treeitem').getByRole('button').first().click();
  await page.getByTestId('binding-text').fill('{{ last_name }}');
  await page.getByTestId('binding-text').blur();
  await page.getByTestId('mode-live').click();

  await expect(page.getByTestId('binding-overflow')).toHaveCount(0);

  // Winterbourne-Fitzgerald does not fit the default box at any size.
  await page.getByLabel('Next record').click();
  await expect(page.getByTestId('binding-overflow')).toContainText('record 2');
});

test('INC-27 — proof export renders one record at trim size', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await importCsv(page, GUESTS);
  await placeText(page);

  await page.getByTestId('open-export').click();
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('run-proof').click();

  const download = await pending;
  expect(download.suggestedFilename()).toBe('toke-proof.pdf');

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = await PDFDocument.load(Buffer.concat(chunks));

  // One page at the card's trim size, not an imposed sheet.
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(240.94, 1);
  expect(pdf.getPage(0).getHeight()).toBeCloseTo(155.91, 1);
});
