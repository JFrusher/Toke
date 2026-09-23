import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * v1.1 — data-driven design: column bindings, the image library, and the
 * persistence they depend on.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Grace,Hopper'].join('\n');

/** A 4x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD0In+KAAAAE0lEQVR42mP8z8BQz0BsYBxVSFdAADYWBoGPQrDaAAAAAElFTkSuQmCC',
  'base64',
);

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function centre(page: Page) {
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pdfFrom(page: Page, trigger: () => Promise<void>) {
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await trigger();
  const bytes = await readFile(await (await pending).path());
  return PDFDocument.load(bytes);
}

const hasImage = (pdf: PDFDocument) =>
  pdf.context
    .enumerateIndirectObjects()
    .some(([, object]) => /\/Subtype\s*\/Image/.test(String(object)));

test('a project opened in a fresh browser brings its images with it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await ready(page);
  // A proof prints one record, so the run needs one.
  await importCsv(page, GUESTS);
  await page.getByTestId('image-file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  const saved = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const bytes = await readFile(await (await saved).path());

  // A new context has an empty IndexedDB — another machine, in effect.
  const elsewhere = await (await browser.newContext()).newPage();
  await ready(elsewhere);
  await elsewhere.getByTestId('project-file').setInputFiles({
    name: 'WithImage.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });
  await expect(elsewhere.getByRole('treeitem')).toHaveCount(1);

  // The proof fails with PDF_ASSET_MISSING if the bytes did not come across.
  await elsewhere.getByTestId('open-export').click();
  const pdf = await pdfFrom(elsewhere, () => elsewhere.getByTestId('run-proof').click());
  expect(hasImage(pdf)).toBe(true);
});

test('moving a token-bound text in live mode keeps its template', async ({ page }) => {
  // Live mode shows the resolved name; a drag used to commit "Ada Lovelace"
  // over "{{ first_name }} {{ last_name }}", un-binding the text for good.
  await ready(page);
  await importCsv(page, GUESTS);
  const c = await centre(page);

  await page.getByTestId('tool-text').click();
  await page.mouse.click(c.x, c.y);
  await page.getByRole('treeitem').getByRole('button').first().click();
  await page.getByTestId('binding-text').fill('{{ first_name }} {{ last_name }}');
  await page.getByTestId('binding-text').blur();

  await page.getByTestId('mode-live').click();
  await page.mouse.move(c.x + 8, c.y + 8);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 6 });
  await page.mouse.up();

  await page.getByTestId('mode-token').click();
  await page.getByRole('treeitem').getByRole('button').first().click();
  await expect(page.getByTestId('binding-text')).toHaveValue('{{ first_name }} {{ last_name }}');
});
