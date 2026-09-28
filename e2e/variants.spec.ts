import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * v1.1 — variant layouts: a column picks the design per record, or each
 * design prints as its own run.
 */

const GUESTS = ['first_name,last_name,layout', 'Ada,Lovelace,', 'Grace,Hopper,Veg'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function place(page: Page, tool: string) {
  await page.getByTestId(`tool-${tool}`).click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Standard design with a rectangle, and a "veg" design with an ellipse. */
async function twoDesigns(page: Page) {
  await ready(page);
  await importCsv(page, GUESTS);
  await place(page, 'rect');

  await page.getByTestId('design-add').click();
  await page.getByTestId('design-rename').click();
  await page.getByTestId('design-name').fill('veg');
  await page.getByTestId('design-name').press('Enter');
  await place(page, 'ellipse');

  await page.getByTestId('design-switcher').selectOption({ label: 'Design 1' });
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.getByTestId('open-export').click();
}

test('a column picks each record’s design in one run', async ({ page }) => {
  test.setTimeout(120_000);
  await twoDesigns(page);

  await page.getByTestId('export-layout-column').selectOption('layout');
  // What will print, before anything does.
  await expect(page.getByTestId('export-variants')).toContainText('1 × Design 1');
  await expect(page.getByTestId('export-variants')).toContainText('1 × Veg');

  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('run-export').click();
  const pdf = await PDFDocument.load(await readFile(await (await pending).path()));
  expect(pdf.getPageCount()).toBe(1);
});

test('a value that names no design stops the run before it starts', async ({ page }) => {
  await twoDesigns(page);

  await page.getByTestId('export-layout-column').selectOption('first_name');
  await expect(page.getByRole('dialog').getByRole('alert').first()).toContainText(
    'No design is called',
  );
  await expect(page.getByTestId('run-export')).toBeDisabled();
});

test('each design can print as its own file', async ({ page }) => {
  test.setTimeout(120_000);
  await twoDesigns(page);

  const names: string[] = [];
  page.on('download', (download) => names.push(download.suggestedFilename()));
  await page.getByTestId('run-export-each').click();

  await expect.poll(() => names.length, { timeout: 90_000 }).toBe(2);
  expect(names.sort()).toEqual(['toke-design-1.pdf', 'toke-veg.pdf']);
});
