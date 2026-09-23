import { expect, type Page, test } from '@playwright/test';
import { importCsv, openDock } from './helpers';

/**
 * v1.1 — a CSV becomes a table of its own.
 *
 * Real data rarely matches the fixed guest schema. Importing into a new table
 * keeps the file's own columns, and the record source can join it to anything.
 */

const GUESTS = ['first_name,last_name,table_number', 'Ada,Lovelace,1', 'Grace,Hopper,2'].join(
  '\n',
);
const MENUS = ['Table Number,Main Course', '1,Wild mushroom risotto', '2,Roast chicken'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');
}

async function importAsNewTable(page: Page, csv: string, file: string, name?: string) {
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: file,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByTestId('import-into-new').check();
  if (name !== undefined) await page.getByTestId('import-table-name').fill(name);
  await page.getByTestId('csv-confirm').click();
}

test('a CSV imports as a new table with its own columns', async ({ page }) => {
  await ready(page);
  await importAsNewTable(page, MENUS, 'Menu Choices.csv');
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 45_000 });

  await openDock(page);
  // The grid switches to what was just made, named after the file.
  await expect(page.getByTestId('grid-table')).toHaveValue('menu_choices');
  await expect(page.getByRole('grid')).toContainText('Wild mushroom risotto');
  await expect(page.getByRole('grid')).toContainText('main_course');

  // Both tables stay reachable.
  await page.getByTestId('grid-table').selectOption('guests');
  await expect(page.getByRole('grid')).toContainText('first_name');
});

test('a row can be added to a table with no required columns', async ({ page }) => {
  // addRow used to insert first_name and last_name, which only guests has.
  await ready(page);
  await importAsNewTable(page, MENUS, 'menus.csv');
  await openDock(page);
  await expect(page.getByRole('grid')).toContainText('Roast chicken', { timeout: 45_000 });

  await page.getByTestId('add-row').click();
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '4');
});

test('an existing table name is refused and nothing is imported', async ({ page }) => {
  await ready(page);
  await importAsNewTable(page, MENUS, 'menus.csv', 'guests');

  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'already a table called guests',
  );
});

test('the record source can join an imported table to the guests', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await importAsNewTable(page, MENUS, 'menus.csv');
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 45_000 });

  await openDock(page);
  await page.getByTestId('dock-tab-sql').click();
  // The console lists what can be queried, including the new table's columns.
  await expect(page.getByTestId('sql-schema')).toContainText('main_course');

  await page
    .getByTestId('sql-input')
    .fill(
      'SELECT g.first_name, m.main_course FROM guests g JOIN menus m ON m.table_number = g.table_number ORDER BY g.id',
    );
  await page.getByTestId('sql-run').click();
  await expect(page.getByTestId('sql-results')).toContainText('Wild mushroom risotto', {
    timeout: 20_000,
  });
  await page.getByTestId('sql-use-as-source').click();

  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 2', { timeout: 20_000 });
});
