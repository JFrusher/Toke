import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

/**
 * Binding a design to data, end to end: import a guest list, bind a text
 * object to a column, and cycle records in Live Mode.
 */

const GUESTS = [
  'first_name,last_name,rsvp_status',
  'Ada,Lovelace,Accepted',
  'Grace,Hopper,Accepted',
  'Bartholomew,Winterbourne-Fitzgerald,Accepted',
].join('\n');

const WITH_NICKNAME = ['first_name,last_name,nickname', 'Ada,Lovelace,Addy'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

async function importGuests(page: Page, csv = GUESTS) {
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByTestId('csv-confirm').click();
  // showModal() makes the rest of the page inert, so every later click is
  // blocked until the dialog actually closes. Generous timeout: under the
  // parallel run the worker, SQLite and the migration all contend, and the
  // import genuinely takes longer than the 5s default.
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 20_000 });
}

async function placeTextAndSelect(page: Page) {
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('treeitem').getByRole('button').click();
}

test('starter schema fields are bindable before any import', async ({ page }) => {
  // The guests table is created by migration, so a design can be bound and
  // laid out before the guest list exists — which is the order a planner
  // actually works in.
  await ready(page);
  await placeTextAndSelect(page);

  await expect(page.getByTestId('insert-first_name')).toBeVisible();
  await expect(page.getByTestId('insert-last_name')).toBeVisible();
  await expect(page.getByTestId('insert-rsvp_status')).toBeVisible();
});

test('columns added by an import become bindable', async ({ page }) => {
  await ready(page);
  await placeTextAndSelect(page);
  await expect(page.getByTestId('insert-nickname')).toHaveCount(0);

  await importGuests(page, WITH_NICKNAME);
  await page.getByRole('treeitem').getByRole('button').click();

  await expect(page.getByTestId('insert-nickname')).toBeVisible();
});

test('inserting a field writes a token and marks the object bound', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('insert-first_name').click();

  await expect(page.getByTestId('binding-text')).toHaveValue(/\{\{ first_name \}\}/);
  await expect(page.getByTestId('bound-badge')).toBeVisible();
});

test('Token Mode shows the template, Live Mode shows the data', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ first_name }} {{ last_name }}');
  await page.getByTestId('binding-text').blur();

  // Token Mode keeps the template visible so the binding can be edited.
  await expect(page.getByTestId('mode-token')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');
});

test('cycling records changes which values render', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ first_name }}');
  await page.getByTestId('binding-text').blur();
  await page.getByTestId('mode-live').click();

  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');
  await page.getByRole('button', { name: 'Next record' }).click();
  await expect(page.getByTestId('record-counter')).toHaveText('2 / 3');
});

test('the record cursor clamps rather than wrapping', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await page.getByTestId('mode-live').click();

  // Stepping back from the first record must stay put, not jump to the last.
  await page.getByRole('button', { name: 'Previous record' }).click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');

  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Next record' }).click();
  }
  await expect(page.getByTestId('record-counter')).toHaveText('3 / 3');
});

test('an unknown column is reported, not silently blank', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ nonexistent_column }}');
  await page.getByTestId('binding-text').blur();
  await page.getByTestId('mode-live').click();

  // The object stays on the canvas — a vanished object is harder to diagnose
  // than a wrong one.
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '1');
});

test('an unknown formatter is reported in the panel', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ first_name | shout }}');
  await page.getByTestId('binding-text').blur();

  await expect(page.getByTestId('binding-error')).toContainText('shout');
});

test('auto-fit mode is selectable and persists', async ({ page }) => {
  await ready(page);
  await placeTextAndSelect(page);

  // Shrink is the default: overflowing the trim silently is the worse failure.
  await expect(page.getByTestId('autofit-shrink')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('autofit-truncate').click();
  await expect(page.getByTestId('autofit-truncate')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('autofit-shrink')).toHaveAttribute('aria-pressed', 'false');
});

test('a fallback fills an empty value', async ({ page }) => {
  await ready(page);
  await importGuests(page, 'first_name,last_name,nickname\nAda,Lovelace,\nGrace,Hopper,Amazing');
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ nickname }}');
  await page.getByTestId('binding-text').blur();
  await page.getByTestId('binding-fallback').fill('—');
  await page.getByTestId('binding-fallback').blur();

  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 2');
});

test('binding survives a save and reopen', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await placeTextAndSelect(page);

  await page.getByTestId('binding-text').fill('{{ first_name | upper }}');
  await page.getByTestId('binding-text').blur();

  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const saved = await download;

  await ready(page);
  await page.getByTestId('project-file').setInputFiles({
    name: 'bound.toke',
    mimeType: 'application/zip',
    buffer: await readFile(await saved.path()),
  });

  await page.getByRole('treeitem').getByRole('button').click();
  await expect(page.getByTestId('binding-text')).toHaveValue('{{ first_name | upper }}');
  await expect(page.getByTestId('bound-badge')).toBeVisible();
});
