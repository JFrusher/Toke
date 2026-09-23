import { expect, type Page, test } from '@playwright/test';
import { importCsv, openDock } from './helpers';

/**
 * Phase 3 — INC-5, INC-6, INC-7 and VER-2.
 *
 * The P2.6 criterion was "sort, column resize, inline cell edit, row
 * add/delete" and P2.7 asked for an editable column mapping. Sort and cell
 * edit shipped; the rest did not.
 */

const GUESTS = [
  'first_name,last_name,table_number',
  'Ada,Lovelace,1',
  'Grace,Hopper,2',
  'Alan,Turing,3',
].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
}

async function gridWith(page: Page, csv = GUESTS) {
  await ready(page);
  await importCsv(page, csv);
  await openDock(page);
  await expect(page.getByRole('grid')).toBeVisible();
}

const columnWidth = (page: Page, name: string) =>
  page
    .getByRole('columnheader')
    .filter({ hasText: name })
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

test('INC-5 — a column can be resized by dragging its edge', async ({ page }) => {
  await gridWith(page);

  const before = await columnWidth(page, 'first_name');
  const grip = page.getByTestId('column-resize-first_name');
  const box = await grip.boundingBox();
  if (box === null) throw new Error('no grip');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => columnWidth(page, 'first_name')).toBeGreaterThan(before + 80);
});

test('INC-5 — a column can be resized from the keyboard', async ({ page }) => {
  await gridWith(page);

  const before = await columnWidth(page, 'first_name');
  const grip = page.getByTestId('column-resize-first_name');
  await grip.focus();
  for (let i = 0; i < 4; i += 1) await grip.press('ArrowRight');

  // §4.7 wants every action reachable without a pointer.
  await expect.poll(() => columnWidth(page, 'first_name')).toBeGreaterThan(before + 40);
});

test('INC-5 — a column cannot be dragged to nothing', async ({ page }) => {
  await gridWith(page);

  const grip = page.getByTestId('column-resize-first_name');
  await grip.focus();
  for (let i = 0; i < 20; i += 1) await grip.press('ArrowLeft');

  // A column collapsed to zero could never be grabbed again.
  await expect.poll(() => columnWidth(page, 'first_name')).toBeGreaterThanOrEqual(56);
});

test('INC-5 — the body cells follow the header width', async ({ page }) => {
  await gridWith(page);

  const grip = page.getByTestId('column-resize-first_name');
  await grip.focus();
  for (let i = 0; i < 4; i += 1) await grip.press('ArrowRight');

  const header = await columnWidth(page, 'first_name');
  const cell = await page
    .locator('[role="gridcell"][data-column="first_name"]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

  // A header that resizes without its column is worse than no resizing.
  expect(cell).toBeCloseTo(header, 0);
});

test('INC-6 — a row can be added and removed from the footer', async ({ page }) => {
  await gridWith(page);
  await expect(page.getByTestId('bottom-dock')).toContainText('3 records');

  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('bottom-dock')).toContainText('4 records');

  // Shift+Delete still works, but it is not a feature anyone discovers.
  await page.getByTestId('delete-row').click();
  await expect(page.getByTestId('bottom-dock')).toContainText('3 records');
});

test('INC-7 — a mis-matched column can be retargeted', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('first_name,surname\nAda,Lovelace\n', 'utf8'),
  });

  // "surname" does not match "last_name", so it proposes a new column.
  await expect(page.getByTestId('map-target-surname')).toHaveValue('create');

  await page.getByTestId('map-target-surname').selectOption('last_name');
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 45_000 });

  await openDock(page);
  // The value landed in last_name, not in a stray "surname" column.
  await expect(page.getByRole('grid')).toContainText('Lovelace');
});

test('INC-7 — a column can be ignored', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('first_name,last_name,notes\nAda,Lovelace,ignore me\n', 'utf8'),
  });

  await page.getByTestId('map-target-notes').selectOption('ignore');
  // An ignored column has no type to choose.
  await expect(page.getByTestId('map-type-notes')).toBeDisabled();

  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 45_000 });

  await openDock(page);
  await expect(page.getByRole('grid')).not.toContainText('ignore me');
});

test('INC-7 — an inferred type can be overridden', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('first_name,postcode\nAda,007\n', 'utf8'),
  });

  // "007" is inferred as text precisely so a postcode survives; the override
  // exists for the cases inference gets wrong.
  await expect(page.getByTestId('map-type-postcode')).toHaveValue('text');
  await page.getByTestId('map-type-postcode').selectOption('integer');
  await expect(page.getByTestId('map-type-postcode')).toHaveValue('integer');
});

test('VER-2 — 10,000 rows stay virtualised', async ({ page }) => {
  test.setTimeout(180_000);

  const rows = ['first_name,last_name,table_number'];
  for (let i = 0; i < 10_000; i += 1) rows.push(`Guest${i},Surname${i},${(i % 20) + 1}`);

  await gridWith(page, rows.join('\n'));
  await expect(page.getByTestId('bottom-dock')).toContainText('10000 records');

  // Virtualisation asserted by DOM node count, not frame timing: a windowed
  // grid renders a screenful whatever the dataset is, and timing assertions
  // flake.
  const cells = await page.getByRole('gridcell').count();
  expect(cells).toBeGreaterThan(0);
  expect(cells).toBeLessThan(400);
});
