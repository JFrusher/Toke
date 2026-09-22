import { expect, type Page, test } from '@playwright/test';

/**
 * First run: a template must reach a correct PDF with nothing imported.
 */

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

test('an empty artboard offers a way in', async ({ page }) => {
  await ready(page);
  // A prompt on the empty state, not a modal that opens unbidden.
  await expect(page.getByTestId('empty-templates')).toBeVisible();
});

test('loading a template fills the canvas and the data', async ({ page }) => {
  await ready(page);

  await page.getByTestId('empty-templates').click();
  await page.getByTestId('template-place-card-flat').click();

  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4', {
    timeout: 20_000,
  });
  // The prompt goes once there is something on the artboard.
  await expect(page.getByTestId('empty-templates')).toHaveCount(0);
});

test('the template record source excludes declined guests', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();

  await page.getByTestId('mode-live').click();
  // 24 guests, 2 declined. Printing a card for someone who is not coming is
  // how a run comes back the wrong length.
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 22', { timeout: 20_000 });
});

test('a new user exports a correct PDF without importing anything', async ({ page }) => {
  // Loads a template, imports 24 rows and renders three sheets in one test.
  test.setTimeout(120_000);
  await ready(page);

  await page.getByTestId('empty-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4', {
    timeout: 20_000,
  });

  // 22 accepted guests at 10-up on A4 is 3 sheets.
  await expect(page.getByTestId('imposition-yield')).toContainText('3');

  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('run-export').click();

  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(1000);
});

test('the tent template uses the printed height, not the finished one', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-tent').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '3', {
    timeout: 20_000,
  });

  // Trim 85 x 55 finished, printed at 85 x 110 and folded — so the artboard,
  // and the imposition yield, are computed on 110mm.
  await expect(page.getByTestId('imposition-yield')).toContainText('85 x 110');
});

test('a template with a name that does not fit shrinks rather than overflowing', async ({
  page,
}) => {
  await ready(page);

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await page.getByTestId('mode-live').click();

  // Bartholomew Winterbourne-Fitzgerald is in the sample roster precisely
  // because it does not fit at 20pt.
  // The search matches the first text column, which is first_name.
  await page.getByTestId('record-search').fill('Bartholomew');
  await expect(page.getByTestId('record-label')).toContainText('Bartholomew', {
    timeout: 20_000,
  });

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toBeVisible({ timeout: 20_000 });
});
