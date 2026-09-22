import { expect, type Page, test } from '@playwright/test';
import { openDock } from './helpers';

/**
 * Live Mode over the design's record source, and the pre-export scan.
 */

const GUESTS = [
  'first_name,last_name,rsvp_status',
  'Ada,Lovelace,Accepted',
  'Grace,Hopper,Accepted',
  'Bartholomew,Winterbourne-Fitzgerald,Declined',
].join('\n');

/** Short enough to fit the default text box, which is sized to the word "Text". */
const SHORT_NAMES = ['first_name,last_name', 'Ada,Lovelace', 'Eve,Ball'].join('\n');

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
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 20_000 });
}

async function bindText(page: Page, template: string) {
  await page.getByTestId('tool-text').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('treeitem').getByRole('button').click();
  await page.getByTestId('binding-text').fill(template);
  await page.getByTestId('binding-text').blur();
}

test('the cycle bar walks the record source', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await page.getByTestId('mode-live').click();

  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');

  await page.getByRole('button', { name: 'Last record' }).click();
  await expect(page.getByTestId('record-counter')).toHaveText('3 / 3');

  await page.getByRole('button', { name: 'First record' }).click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');
});

test('end controls disable at the ends rather than wrapping', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await page.getByTestId('mode-live').click();

  await expect(page.getByRole('button', { name: 'Previous record' })).toBeDisabled();
  await page.getByRole('button', { name: 'Last record' }).click();
  await expect(page.getByRole('button', { name: 'Next record' })).toBeDisabled();
});

test('search jumps to a matching record', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await page.getByTestId('mode-live').click();

  await page.getByTestId('record-search').fill('Bartholomew');
  await expect(page.getByTestId('record-counter')).toHaveText('3 / 3');
  await expect(page.getByTestId('record-label')).toContainText('Bartholomew');
});

test('a search that matches nothing keeps the current record', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await page.getByTestId('mode-live').click();

  await page.getByRole('button', { name: 'Next record' }).click();
  await expect(page.getByTestId('record-counter')).toHaveText('2 / 3');

  // Losing the user's place on every keystroke that misses would make the
  // field unusable while typing a name.
  await page.getByTestId('record-search').fill('zzzzz');
  await expect(page.getByTestId('record-counter')).toHaveText('2 / 3');
});

test('pre-flight reports a clean run when every value fits', async ({ page }) => {
  // Short names only. The default text box is sized to the word "Text" — about
  // 34pt — so a long surname legitimately overflows it, which the next test
  // covers.
  await ready(page);
  await importGuests(page, SHORT_NAMES);
  await bindText(page, '{{ first_name }}');

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toHaveAttribute('data-clean', 'true');
  await expect(page.getByTestId('preflight-summary')).toContainText('no issues');
});

test('pre-flight catches a name that will not fit the box', async ({ page }) => {
  // The headline value: "Bartholomew" in a box drawn for "Text" cannot shrink
  // far enough, and nobody would notice until the cards were printed.
  await ready(page);
  await importGuests(page);
  await bindText(page, '{{ first_name }}');

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toHaveAttribute('data-clean', 'false');

  const finding = page.getByTestId('preflight-finding').first();
  await expect(finding).toContainText('Overflow');
  // The offending VALUE is named, not just the record number.
  await expect(finding).toContainText('Bartholomew');
});

test('pre-flight flags an unresolvable column', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await bindText(page, '{{ nonexistent }}');

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toHaveAttribute('data-clean', 'false');
  await expect(page.getByTestId('preflight-finding').first()).toContainText('nonexistent');
});

test('a malformed binding is reported, not skipped', async ({ page }) => {
  // The hole worth guarding: an unparseable token means isTokenised is false,
  // so a naive scan skips the node and calls the run clean while that object
  // prints nothing.
  await ready(page);
  await importGuests(page);
  await bindText(page, '{{ first_name | shout }}');

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toHaveAttribute('data-clean', 'false');
});

test('selecting a finding jumps to that record in Live Mode', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await bindText(page, '{{ nonexistent }}');

  await page.getByTestId('open-preflight').click();
  await page.getByTestId('preflight-finding').first().click();

  // A structural failure is not record-specific, so the mode stays put; the
  // object is selected so the user can fix the binding.
  await expect(page.getByTestId('binding-text')).toHaveValue('{{ nonexistent }}');
});

test('pre-flight does not block, it warns', async ({ page }) => {
  await ready(page);
  await importGuests(page);
  await bindText(page, '{{ nonexistent }}');

  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toContainText('need attention');
  await page.keyboard.press('Escape');

  // Saving still works with findings outstanding.
  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  expect((await download).suggestedFilename()).toContain('.toke');
});

test('Live Mode previews the record source, not the whole table', async ({ page }) => {
  await ready(page);
  await importGuests(page);

  // Default source is every guest; the grid shows the same three.
  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('record-counter')).toHaveText('1 / 3');

  await openDock(page);
  await expect(page.getByRole('grid')).toContainText('3 records');
});
