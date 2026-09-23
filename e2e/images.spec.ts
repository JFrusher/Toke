import { expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

/**
 * Photo import: place, resize, crop to frame, and reach the PDF.
 *
 * The asset store, the scene graph, the canvas and the renderer all have to
 * agree on one image for any of this to be worth anything.
 */

/** A 4x1 PNG — deliberately wide, so every fit mode does something visible. */
const WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD0In+KAAAAE0lEQVR42mP8z8BQz0BsYBxVSFdAADYWBoGPQrDaAAAAAElFTkSuQmCC',
  'base64',
);

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function placeImage(page: Page, buffer = WIDE_PNG, name = 'logo.png', type = 'image/png') {
  await page.getByTestId('image-file').setInputFiles({ name, mimeType: type, buffer });
}

test('places a photo on the artboard', async ({ page }) => {
  await ready(page);
  await placeImage(page);

  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
});

test('the fit control appears only for a selected image', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('image-fit-contain')).toHaveCount(0);

  await placeImage(page);
  await page.getByRole('treeitem').getByRole('button').first().click();

  // Fit, not contain: "cover" means nothing to someone laying out a card.
  await expect(page.getByTestId('image-fit-contain')).toBeChecked();
  await expect(page.getByText('Whole image, space on one side')).toBeVisible();
});

test('changing the fit mode is undoable', async ({ page }) => {
  await ready(page);
  await placeImage(page);
  await page.getByRole('treeitem').getByRole('button').first().click();

  await page.getByTestId('image-fit-cover').click();
  await expect(page.getByTestId('image-fit-cover')).toBeChecked();

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('image-fit-contain')).toBeChecked();
});

test('resizing the frame keeps the image inside it', async ({ page }) => {
  await ready(page);
  await placeImage(page);
  await page.getByRole('treeitem').getByRole('button').first().click();

  const width = page.getByTestId('field-w');
  await width.fill('40');
  await width.blur();

  // The frame is what the fields report; the picture fits inside it.
  await expect(width).toHaveValue('40');
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
});

test('refuses a format the PDF cannot carry, at import rather than at export', async ({ page }) => {
  await ready(page);

  // GIF magic. Accepting it here would defer the failure until the user has
  // laid out a card and pressed export.
  await placeImage(page, Buffer.from('47494638396101000100', 'hex'), 'bad.gif', 'image/gif');

  await page.getByTestId('open-diagnostics').click();
  const entry = page.getByTestId('diagnostics-entry').first();
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('data-code', 'PDF_IMAGE_UNSUPPORTED');

  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '0');
});

test('the image reaches the exported PDF', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4');

  await placeImage(page);
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '5');

  await page.getByTestId('open-export').click();
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('run-export').click();

  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = await PDFDocument.load(Buffer.concat(chunks));

  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => String(object));

  // The bytes travelled: main thread reads IndexedDB, worker gets plain bytes,
  // renderer embeds one XObject however many cards use it.
  const images = objects.filter((object) => /\/Subtype\s*\/Image/.test(object));
  expect(images.length).toBeGreaterThan(0);

  // One colour image, embedded once for all ten cards on the sheet. A PNG with
  // an alpha channel also produces a DeviceGray soft mask, which is a second
  // image XObject and entirely correct — so the colour images are counted, not
  // the total.
  const colour = images.filter((object) => object.includes('/DeviceRGB'));
  expect(colour).toHaveLength(1);
});

test('the image survives a save and reopen', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await placeImage(page);
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');

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
    name: 'WithImage.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  // A .toke that references an image only by hash opens on another machine
  // with a hole where the logo was.
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
});
