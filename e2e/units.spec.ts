import { expect, type Page, test } from '@playwright/test';

/**
 * The display unit drives every measurement shown.
 *
 * Points are the internal unit and never change; this is a render-time
 * conversion, so switching it must not move a single object (CLAUDE.md §6).
 */

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
  await page.getByRole('treeitem').getByRole('button').click();
}

test('defaults to millimetres', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('display-unit')).toHaveValue('mm');
});

test('switching the unit converts the transform fields', async ({ page }) => {
  await ready(page);
  await placeRect(page);

  await page.getByTestId('field-w').fill('25.4');
  await page.getByTestId('field-w').blur();
  await expect(page.getByTestId('field-w')).toHaveValue('25.4');

  // 25.4mm is exactly one inch — a conversion that is wrong by any factor
  // shows up immediately.
  await page.getByTestId('display-unit').selectOption('in');
  await expect(page.getByTestId('field-w')).toHaveValue('1');

  await page.getByTestId('display-unit').selectOption('pt');
  await expect(page.getByTestId('field-w')).toHaveValue('72');
});

test('switching the unit does not move anything', async ({ page }) => {
  await ready(page);
  await placeRect(page);

  await page.getByTestId('field-x').fill('20');
  await page.getByTestId('field-x').blur();

  await page.getByTestId('display-unit').selectOption('pt');
  await page.getByTestId('display-unit').selectOption('mm');

  // Round-tripping the display must return the same number: geometry is in
  // points and the unit is a view concern only.
  await expect(page.getByTestId('field-x')).toHaveValue('20');
});

test('the imposition panel follows the unit', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('imposition-bleed')).toHaveValue('3');

  await page.getByTestId('display-unit').selectOption('pt');
  // 3mm is 8.5pt.
  await expect(page.getByTestId('imposition-bleed')).toHaveValue('8.5');
  // 85 x 55mm is 240.94 x 155.91pt.
  await expect(page.getByTestId('imposition-yield')).toContainText('240.94 x 155.91');
});

test('the chosen unit survives a reload', async ({ page }) => {
  await ready(page);
  await page.getByTestId('display-unit').selectOption('in');

  await page.reload();
  // Someone who works in inches works in inches whatever they open next.
  await expect(page.getByTestId('display-unit')).toHaveValue('in', { timeout: 20_000 });
});
