import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { importCsv } from './helpers';

/**
 * INC-15, INC-11 and VER-7 — user typefaces.
 *
 * `loadFont`'s TTF path was built and tested and nothing called it: there was
 * no upload, no picker, and the 0.5pt measurement agreement was proved only
 * for the faces this build happens to ship.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace'].join('\n');

/** A real TTF that is NOT one of the bundled faces. */
const USER_FONT = readFileSync(
  'node_modules/@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf',
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
  await page.getByRole('treeitem').getByRole('button').first().click();
}

async function uploadFont(page: Page, name = 'Wedding Script.ttf') {
  await page.getByTestId('font-file').setInputFiles({
    name,
    mimeType: 'font/ttf',
    buffer: USER_FONT,
  });
}

test('the family list offers only faces that are actually loaded', async ({ page }) => {
  await ready(page);
  await placeText(page);

  // The picker reads the registry, so it can never offer a face the PDF
  // renderer cannot embed.
  const options = await page.getByTestId('font-family').locator('option').allTextContents();
  expect(options).toContain('IBM Plex Sans');
  expect(options).not.toContain('Wedding Script');
});

test('INC-15 — an uploaded typeface becomes selectable', async ({ page }) => {
  await ready(page);
  await placeText(page);

  await uploadFont(page);

  await expect
    .poll(async () => page.getByTestId('font-family').locator('option').allTextContents())
    .toContain('Wedding Script');
});

test('VER-7 — an uploaded face is embedded in the PDF, not substituted', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await importCsv(page, GUESTS);
  await placeText(page);
  await uploadFont(page);
  await page.getByTestId('font-family').selectOption('Wedding Script');

  await page.getByTestId('open-export').click();
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('run-proof').click();

  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = await PDFDocument.load(Buffer.concat(chunks));

  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => String(object));

  // The user's own file is embedded as a subset. A substituted face would
  // measure differently from the canvas and print differently from the proof,
  // which is the exact failure the 0.5pt agreement exists to prevent.
  expect(objects.some((object) => object.includes('/FontFile2'))).toBe(true);
  expect(objects.some((object) => /\/BaseFont \/[\w-]*Bold/i.test(object))).toBe(true);
});

test('INC-11 / VER-7 — an uploaded face survives a save and reopen', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await placeText(page);
  await uploadFont(page);
  await page.getByTestId('font-family').selectOption('Wedding Script');

  const width = await page.getByTestId('field-w').inputValue();

  const saving = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const file = await saving;

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await page.getByTestId('project-file').setInputFiles({
    name: 'WithFont.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  await page.getByRole('treeitem').getByRole('button').first().click();

  // The face travelled inside the file, so the text measures identically. A
  // project that opened with a substituted face would lay out differently and
  // print differently.
  await expect(page.getByTestId('font-family')).toHaveValue('Wedding Script');
  await expect.poll(() => page.getByTestId('field-w').inputValue()).toBe(width);
});

test('VER-7 — an unreadable file is refused rather than registered', async ({ page }) => {
  await ready(page);
  await placeText(page);

  await page.getByTestId('font-file').setInputFiles({
    name: 'Broken.ttf',
    mimeType: 'font/ttf',
    buffer: Buffer.from('not a font at all'),
  });

  await page.getByTestId('open-diagnostics').click();
  const entry = page.getByTestId('diagnostics-entry').first();
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('data-code', 'FONT_UNREADABLE');
});
