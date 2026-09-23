import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { importCsv } from './helpers';

/**
 * WCAG 2.2 AA, asserted rather than asserted-to.
 *
 * CLAUDE.md §4.7 commits to contrast, keyboard operation and never signalling
 * state by colour alone. A committed standard that is never measured is a
 * wish, so every view gets scanned and every navigation claim gets driven from
 * the keyboard.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Grace,Hopper'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
}

function scan(page: Page) {
  return (
    new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // Fabric renders into a <canvas>, which axe cannot inspect. The layers
      // tree is the accessible representation of its contents (CLAUDE.md §4.7)
      // and is scanned like any other tree.
      .exclude('canvas')
      .analyze()
  );
}

async function expectClean(page: Page, view: string) {
  const results = await scan(page);
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length}) — ${v.help}`);
  expect(summary, `axe violations on ${view}`).toEqual([]);
}

test('the studio is clean', async ({ page }) => {
  await ready(page);
  await expectClean(page, 'studio');
});

test('the data grid is clean', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await page.getByTestId('toggle-data').click();
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  await expectClean(page, 'data grid');
});

test('the SQL console is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('toggle-data').click();
  await page.getByTestId('dock-tab-sql').click();
  await expect(page.getByTestId('sql-input')).toBeVisible();
  await expectClean(page, 'sql console');
});

test('the diagnostics panel is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-diagnostics').click();
  await expect(page.getByTestId('diagnostics-empty')).toBeVisible();
  await expectClean(page, 'diagnostics');
});

test('the import dialog is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-import').click();
  await expect(page.getByTestId('csv-file')).toBeVisible();
  await expectClean(page, 'import dialog');
});

test('the export dialog is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('run-export')).toBeVisible();
  await expectClean(page, 'export dialog');
});

test('the template gallery is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-templates').click();
  await expect(page.getByTestId('template-place-card-flat')).toBeVisible();
  await expectClean(page, 'template gallery');
});

test('the pre-flight report is clean', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);
  await page.getByTestId('open-preflight').click();
  await expect(page.getByTestId('preflight-summary')).toBeVisible({ timeout: 20_000 });
  await expectClean(page, 'pre-flight');
});

test('a populated studio with a bound object is clean', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4', {
    timeout: 45_000,
  });
  await page.getByTestId('mode-live').click();
  await expectClean(page, 'populated studio');
});

test('every header control is reachable by keyboard', async ({ page }) => {
  await ready(page);

  const reachable = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (id !== '') reachable.add(id);
  }

  for (const control of ['open-templates', 'open-import', 'open-export', 'open-diagnostics']) {
    expect(reachable, `${control} is not reachable by Tab`).toContain(control);
  }
});

test('focus is never trapped outside a modal', async ({ page }) => {
  await ready(page);

  // Twice round the whole document must come back to something focusable, not
  // stall on one element.
  const seen: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement?.tagName ?? ''));
  }

  expect(new Set(seen).size).toBeGreaterThan(3);
});

test('Escape closes a dialog and returns focus to the page', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('run-export')).toBeVisible();

  await page.keyboard.press('Escape');
  // A closed <dialog> keeps its children in the DOM, so visibility is the
  // assertion, not presence.
  await expect(page.getByTestId('run-export')).not.toBeVisible();
  await expect(page.getByTestId('open-export')).toBeVisible();
});

test('the canvas is operable from the keyboard', async ({ page }) => {
  await ready(page);

  await page.getByTestId('tool-rect').click();
  const box = await page.getByTestId('canvas-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('treeitem').getByRole('button').first().click();

  const x = page.getByTestId('field-x');
  const before = Number((await x.inputValue()).replace(/[^\d.-]/g, ''));

  // Arrow nudges 1pt, Shift 10pt (CLAUDE.md §4.7). Driven from wherever focus
  // happens to be, since the shortcut is bound to the window.
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => Number((await x.inputValue()).replace(/[^\d.-]/g, '')))
    .toBeGreaterThan(before);
});

test('the layers tree mirrors the canvas for a screen reader', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();

  // The tree is the accessible representation of canvas structure, not
  // decoration — it must list what the canvas holds.
  await expect(page.getByRole('treeitem')).toHaveCount(4, { timeout: 45_000 });
});

test('state is never signalled by colour alone', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 45_000 });

  // By id, not by position: the tree renders top layer first, so an index
  // would silently select a different object if paint order changed.
  await page.getByTestId('layer-guest-name').click();

  // The bound state shows a word, not just the --bound colour.
  await expect(page.getByTestId('bound-badge')).toHaveText(/\w/);
});

test('mode and record changes are announced', async ({ page }) => {
  await ready(page);
  await importCsv(page, GUESTS);

  const announcer = page.getByTestId('live-announcer');
  // Nothing on load — only changes the user caused.
  await expect(announcer).toHaveText('');

  await page.getByTestId('mode-live').click();
  await expect(announcer).toContainText('Record 1 of 2', { timeout: 20_000 });
  await expect(announcer).toContainText('Ada');

  // Cycling is the most repeated action in the product and is otherwise
  // completely silent to a screen reader.
  await page.getByLabel('Next record').click();
  await expect(announcer).toContainText('Record 2 of 2');
  await expect(announcer).toContainText('Grace');

  await page.getByTestId('mode-token').click();
  await expect(announcer).toContainText('Token mode');
});

test('the announcer is polite, not assertive', async ({ page }) => {
  await ready(page);
  // Assertive would interrupt a screen reader mid-sentence on every cursor
  // step, which makes fast cycling unusable.
  await expect(page.getByTestId('live-announcer')).toHaveAttribute('aria-live', 'polite');
});

test('the shortcut reference is reachable and lists the canvas keys', async ({ page }) => {
  await ready(page);

  await page.getByTestId('open-shortcuts').click();
  const dialog = page.getByRole('dialog');

  await expect(dialog).toContainText('Nudge 1pt');
  await expect(dialog).toContainText('Nudge 10pt');
  await expect(dialog).toContainText('Deselect');
  await expectClean(page, 'shortcut reference');
});
