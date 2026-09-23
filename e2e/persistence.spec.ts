import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { openDock } from './helpers';

/**
 * Proves a design survives a real .toke file: packed in the browser,
 * downloaded to disk, read back and reopened.
 */

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('canvas[data-fabric="main"]')).toBeVisible();
}

async function place(page: Page, tool: string, offset = { x: 0, y: 0 }) {
  await page.getByTestId(`tool-${tool}`).click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
}

test('starts clean and goes dirty on the first edit', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('dirty-flag')).toHaveAttribute('data-dirty', 'false');

  await place(page, 'rect');
  await expect(page.getByTestId('dirty-flag')).toHaveAttribute('data-dirty', 'true');
});

test('saving downloads a .toke file named after the project', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');

  await page.getByTestId('project-name').fill('Winterbourne');
  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();

  const file = await download;
  expect(file.suggestedFilename()).toBe('Winterbourne.toke');

  const path = await file.path();
  const bytes = await readFile(path);
  // PK zip magic — the file is a real archive, not an empty placeholder.
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(bytes.byteLength).toBeGreaterThan(100);
});

test('saving clears the unsaved marker', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');
  await expect(page.getByTestId('dirty-flag')).toHaveAttribute('data-dirty', 'true');

  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  await download;

  await expect(page.getByTestId('dirty-flag')).toHaveAttribute('data-dirty', 'false');
});

test('a saved project reopens with its objects intact', async ({ page }) => {
  await ready(page);

  await place(page, 'rect', { x: -40, y: -20 });
  await place(page, 'ellipse', { x: 40, y: 20 });
  await expect(page.getByRole('treeitem')).toHaveCount(2);

  await page.getByTestId('project-name').fill('RoundTrip');
  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const saved = await download;
  const bytes = await readFile(await saved.path());

  // Fresh page: nothing survives in memory.
  await ready(page);
  await expect(page.getByRole('treeitem')).toHaveCount(0);

  await page.getByTestId('project-file').setInputFiles({
    name: 'RoundTrip.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  await expect(page.getByRole('treeitem')).toHaveCount(2);
  await expect(page.getByTestId('project-name')).toHaveValue('RoundTrip');
  // The objects reached Fabric, not just the layers tree.
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '2');
});

test('imported guest data survives the round trip', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-file').setInputFiles({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('first_name,last_name\nAda,Lovelace\nGrace,Hopper', 'utf8'),
  });
  await page.getByTestId('csv-confirm').click();
  // The modal makes the page inert until it closes, and under the parallel
  // run the import genuinely outlasts the 5s default: worker, SQLite, the
  // migration and now the record-source query all contend.
  await expect(page.getByTestId('csv-file')).not.toBeVisible({ timeout: 20_000 });

  await openDock(page);
  await expect(page.getByRole('grid')).toContainText('Lovelace', { timeout: 20_000 });

  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const bytes = await readFile(await (await download).path());

  await ready(page);
  await page.getByTestId('project-file').setInputFiles({
    name: 'WithData.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  await openDock(page);
  // The SQLite file travelled inside the zip, not just the scene graph.
  await expect(page.getByRole('grid')).toContainText('Lovelace', { timeout: 20_000 });
  await expect(page.getByRole('grid')).toContainText('Hopper');
});

test('opening a project clears the undo history', async ({ page }) => {
  await ready(page);
  await place(page, 'rect');

  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const bytes = await readFile(await (await download).path());

  await page.getByTestId('project-file').setInputFiles({
    name: 'Fresh.toke',
    mimeType: 'application/zip',
    buffer: bytes,
  });

  // Undo must not reach back past the load into a scene the file never held.
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('a corrupt file is refused with an explanation', async ({ page }) => {
  await ready(page);

  await page.getByTestId('project-file').setInputFiles({
    name: 'broken.toke',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is definitely not a zip archive', 'utf8'),
  });

  // Matched by text: Next's own __next-route-announcer__ also carries
  // role="alert", so a role locator resolves to two elements.
  await expect(page.getByText(/not a readable toke project/)).toBeVisible();
  // The editor is still usable.
  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
});

test('INC-14: a second tab does not autosave over the first', async ({ page, context }) => {
  await ready(page);

  // Same browser context, same origin: the second tab queues for the lock.
  const second = await context.newPage();
  await ready(second);

  await second.getByTestId('open-diagnostics').click();
  await expect(second.getByTestId('diagnostics-entry')).toContainText('open in another tab');

  // Closing the writer hands autosave to the waiting tab and clears the warning.
  await page.close();
  await expect(second.getByTestId('diagnostics-entry')).toHaveCount(0);
});
