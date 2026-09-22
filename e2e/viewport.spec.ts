import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { importCsv } from './helpers';

/**
 * What toke does at each width.
 *
 * Below 1024px the studio is replaced outright (CLAUDE.md §4.7) rather than
 * reflowed: four panes and sub-millimetre dragging do not work on a phone, and
 * a technically-responsive version of them is worse than an honest message.
 */

const GUESTS = ['first_name,last_name', 'Ada,Lovelace', 'Grace,Hopper'].join('\n');

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('the studio runs at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('the studio runs at exactly 1024px', async ({ page }) => {
  // The breakpoint is inclusive on the studio side: 1024 is wide enough.
  await page.setViewportSize({ width: 1024, height: 800 });
  await ready(page);
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
});

test('768px gets the message, not a reflowed studio', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await ready(page);

  await expect(page.getByText('at least 1024px wide')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('canvas-viewport')).toHaveCount(0);
});

test('390px has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);

  await expect(page.getByText('at least 1024px wide')).toBeVisible({ timeout: 20_000 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('the proof is usable for checking a record on a phone', async ({ page }) => {
  // Import at a width where the studio exists, then shrink.
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4', {
    timeout: 45_000,
  });

  await page.setViewportSize({ width: 390, height: 844 });

  const proof = page.getByTestId('small-proof');
  await expect(proof).toBeVisible({ timeout: 20_000 });
  // The whole point: the guest's actual name, resolved, not the template.
  await expect(proof).toContainText('Ada Lovelace');
  await expect(proof).not.toContainText('{{');

  await page.getByTestId('small-next').click();
  await expect(page.getByTestId('small-counter')).toHaveText('2 / 22');
  await expect(proof).toContainText('Grace Hopper');

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('the proof says so when there is nothing to proof', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.getByTestId('small-empty')).toBeVisible({ timeout: 20_000 });
});

test('the small viewport is clean under axe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  await expect(page.getByTestId('canvas-viewport')).toBeVisible({ timeout: 20_000 });
  await importCsv(page, GUESTS);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('small-proof')).toBeVisible({ timeout: 20_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(results.violations.map((v) => `${v.id} — ${v.help}`)).toEqual([]);
});
