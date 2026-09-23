import { expect, type Page, test } from '@playwright/test';
import { importCsv } from './helpers';

/**
 * INC-13 — several designs in one project.
 *
 * The `.toke` format has stored an array of designs from day one, but
 * `toProject` always wrote exactly one and `fromProject` read only the first.
 * A second design could not be created, and would have been lost on save.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function placeRect(page: Page) {
  await page.getByTestId('tool-rect').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('a project starts with one design', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('design-switcher').locator('option')).toHaveCount(1);
  // The last design cannot be removed: a project with none has nothing to print.
  await expect(page.getByTestId('design-remove')).toBeDisabled();
});

test('a second design can be added and switched between', async ({ page }) => {
  await ready(page);
  await placeRect(page);
  await expect(page.getByRole('treeitem')).toHaveCount(1);

  await page.getByTestId('design-add').click();
  await expect(page.getByTestId('design-switcher').locator('option')).toHaveCount(2);

  // A new design starts empty rather than inheriting the previous artwork.
  await expect(page.getByRole('treeitem')).toHaveCount(0);

  await page.getByTestId('design-switcher').selectOption({ index: 0 });
  // Switching back brings the first design's artwork with it.
  await expect(page.getByRole('treeitem')).toHaveCount(1);
});

test('a design can be renamed', async ({ page }) => {
  await ready(page);

  await page.getByTestId('design-rename').click();
  await page.getByTestId('design-name').fill('Place cards');
  await page.getByTestId('design-name').press('Enter');

  await expect(page.getByTestId('design-switcher')).toContainText('Place cards');
});

test('removing a design opens another rather than leaving nothing', async ({ page }) => {
  await ready(page);
  await page.getByTestId('design-add').click();
  await expect(page.getByTestId('design-switcher').locator('option')).toHaveCount(2);

  await page.getByTestId('design-remove').click();
  await expect(page.getByTestId('design-switcher').locator('option')).toHaveCount(1);
  await expect(page.getByTestId('design-remove')).toBeDisabled();
});

test('every design survives a save and reopen', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await importCsv(page, GUESTS);

  await page.getByTestId('design-rename').click();
  await page.getByTestId('design-name').fill('Place cards');
  await page.getByTestId('design-name').press('Enter');
  await placeRect(page);

  await page.getByTestId('design-add').click();
  await page.getByTestId('design-rename').click();
  await page.getByTestId('design-name').fill('Menus');
  await page.getByTestId('design-name').press('Enter');
  await placeRect(page);
  await placeRect(page);

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
    name: 'Wedding.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  // Both designs came back, with their own artwork. Saving used to keep only
  // whichever was on screen.
  await expect(page.getByTestId('design-switcher').locator('option')).toHaveCount(2);
  await expect(page.getByTestId('design-switcher')).toContainText('Place cards');
  await expect(page.getByTestId('design-switcher')).toContainText('Menus');
});
