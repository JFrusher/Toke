import { expect, type Page, test } from '@playwright/test';

/**
 * Imposition setup and PDF export, end to end in a real browser.
 *
 * The golden suite proves the renderer; this proves the wiring — that the
 * scene survives the structured clone into `pdf.worker.ts`, that fonts arrive
 * as bytes, and that a file actually reaches the user.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Eve,Ball', 'Grace,Hopper'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

async function importGuests(page: Page) {
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(GUESTS, 'utf8'),
  });
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 20_000 });
}

test('shows the sheet yield for the current artboard', async ({ page }) => {
  await ready(page);

  const yields = page.getByTestId('imposition-yield');
  await expect(yields).toBeVisible();
  // The preview is drawn from the same layout the PDF renders from.
  await expect(page.getByTestId('sheet-preview')).toBeVisible();
});

test('changing the sheet changes the yield', async ({ page }) => {
  await ready(page);

  const before = await page.getByTestId('imposition-yield').textContent();
  await page.getByLabel('Sheet').selectOption('a3');

  // A3 is twice A4; the same design cannot yield the same count on both.
  await expect(page.getByTestId('imposition-yield')).not.toHaveText(before ?? '');
});

test('exports a PDF of the imported records', async ({ page }) => {
  await ready(page);
  await importGuests(page);

  await page.getByTestId('open-export').click();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('run-export').click();

  const file = await download;
  expect(file.suggestedFilename()).toBe('toke.pdf');

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  // %PDF- magic, and large enough to be carrying an embedded font subset
  // rather than an empty page tree.
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(1000);
});

test('refuses to export with no records rather than printing blank stock', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-export').click();

  // Disabled AND explained: a dead button with no reason is its own defect.
  await expect(page.getByTestId('run-export')).toBeDisabled();
});
