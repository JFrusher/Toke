import { expect, test } from '@playwright/test';

/* Executable form of P0.1's acceptance criteria. The "no console errors or
   warnings" clause is the one that rots silently, so it is asserted rather
   than eyeballed. */

test('the application boots with a clean console', async ({ page }) => {
  const problems: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toBeAttached();
  expect(problems).toEqual([]);
});

test('no cross-origin isolation headers are served', async ({ page }) => {
  // CLAUDE.md §9 — COEP require-corp would break cross-origin fonts and images
  // for no benefit, since sql.js does not use SharedArrayBuffer. Guard against
  // it being reintroduced.
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};

  expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
});
