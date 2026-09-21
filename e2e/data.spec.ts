import { expect, test } from '@playwright/test';

/**
 * Drives the data layer through the real browser: Worker boot, sql.js WASM
 * fetch, migration, CSV import and grid render. None of that is exercised by
 * the node-side unit tests, which talk to sql.js directly.
 */

const GUESTS = [
  'first_name,last_name,rsvp_status,is_vegetarian',
  'Ada,Lovelace,Accepted,1',
  'Grace,Hopper,Accepted,0',
  'Jean,Bartik,Declined,0',
].join('\n');

/** The data panel is collapsed by default in the studio shell. */
async function openGrid(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('toggle-data').click();
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
}

async function upload(page: import('@playwright/test').Page, csv: string, name = 'guests.csv') {
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
}

test('boots the database worker and shows an empty grid', async ({ page }) => {
  await openGrid(page);
  await expect(page.getByRole('columnheader', { name: /first_name/ })).toBeVisible();
});

test('imports a CSV and renders the rows', async ({ page }) => {
  await openGrid(page);

  await upload(page, GUESTS);
  await expect(page.getByTestId('csv-summary')).toContainText('3');

  await page.getByTestId('csv-confirm').click();

  await expect(page.getByRole('grid')).toContainText('Lovelace');
  await expect(page.getByRole('grid')).toContainText('3 records');
});

test('reports a malformed CSV instead of importing it', async ({ page }) => {
  await openGrid(page);

  await upload(page, 'name,name\na,b', 'duplicate.csv');

  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Duplicate column name');
  await expect(page.getByTestId('csv-confirm')).toBeDisabled();
});

test('warns about ragged rows but still allows import', async ({ page }) => {
  await openGrid(page);

  await upload(page, 'first_name,last_name\nAda,Lovelace\nGrace', 'ragged.csv');

  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'wrong number of columns',
  );
  await expect(page.getByTestId('csv-confirm')).toBeEnabled();
});

test('sorts by a column header', async ({ page }) => {
  await openGrid(page);

  await upload(page, GUESTS);
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByRole('grid')).toContainText('Lovelace');

  const header = page.getByRole('columnheader', { name: /first_name/ });
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
});

test('edits a cell with the keyboard and persists it', async ({ page }) => {
  await openGrid(page);

  await upload(page, GUESTS);
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByRole('grid')).toContainText('Lovelace');

  // Column 0 is id; one step right lands on first_name.
  await page.getByRole('gridcell').first().getByRole('button').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Byron');
  await page.keyboard.press('Enter');

  const grid = page.getByRole('grid');
  await expect(grid).toContainText('Byron');
  // The old value is gone, so the whole string was replaced rather than
  // appended to — and not merely the last keystroke kept.
  await expect(grid).not.toContainText('Ada');
  // Neighbouring cell untouched.
  await expect(grid).toContainText('Lovelace');
});

test('Escape abandons an edit without writing it', async ({ page }) => {
  await openGrid(page);

  await upload(page, GUESTS);
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByRole('grid')).toContainText('Lovelace');

  await page.getByRole('gridcell').first().getByRole('button').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Discarded');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('grid')).not.toContainText('Discarded');
  await expect(page.getByRole('grid')).toContainText('Ada');
});

test('the dialog closes on Escape', async ({ page }) => {
  await openGrid(page);

  await page.getByTestId('open-import').click();
  await expect(page.getByTestId('csv-file')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('csv-file')).not.toBeVisible();
});
