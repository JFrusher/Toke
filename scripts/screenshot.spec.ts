import { expect, test } from '@playwright/test';

/**
 * Captures the README screenshot.
 *
 * Committed rather than shot by hand so the image can be regenerated when the
 * interface changes, instead of quietly ageing into a picture of a product
 * that no longer exists.
 *
 *   npx playwright test scripts/screenshot.spec.ts --config=playwright.config.ts
 */
test('studio', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto('/');
  // Cleared so the shot always shows default panel sizes.
  await page.evaluate(() => window.localStorage.removeItem('toke.shell.v1'));
  await page.reload();

  await expect(page.getByTestId('canvas-viewport')).toBeVisible();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');

  // The dock opens BEFORE the template loads, so the canvas fits the artboard
  // to the space it actually has rather than to the full-height viewport.
  await page.getByTestId('toggle-data').click();

  await page.getByTestId('open-templates').click();
  await page.getByTestId('template-place-card-flat').click();
  await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fabric-objects', '4');

  // Live mode with a record showing: a screenshot of an empty artboard says
  // nothing about what the tool is for.
  await page.getByTestId('mode-live').click();
  await expect(page.getByRole('grid')).toBeVisible();

  await page.getByTestId('layer-guest-name').click();

  // Zoom-to-fit runs on mount, not when a panel opens, so the whole card is
  // brought back into view by hand.
  await page.getByLabel('Zoom out').click();

  // Next's development indicator is a floating badge that has no business in
  // a picture of the product.
  await page.addStyleTag({
    content: '[data-nextjs-dev-tools-button], nextjs-portal { display: none !important; }',
  });

  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'docs/studio.png' });
});
