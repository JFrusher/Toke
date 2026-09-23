import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

/**
 * VER-6 — autosave against a real storage quota.
 *
 * The unit tests throw a stand-in. This shrinks the origin's quota through
 * Chrome's DevTools protocol so IndexedDB itself raises QuotaExceededError on
 * the snapshot write, and asserts the user is told rather than left believing
 * their work is being kept.
 *
 * Chrome checks quota at COMMIT: the put's request succeeds, then the
 * transaction aborts. Autosave used to settle on the request, so this exact
 * failure was reported as a saved snapshot — the test failed until autosave
 * waited for the transaction. `navigator.storage.estimate()` does not reflect
 * the override, so do not use it to check the override took.
 *
 * A persistent context and the override set before navigation: that is the
 * configuration verified to enforce it.
 */

test('a full disk stops autosave loudly, not silently', async ({ baseURL }) => {
  if (baseURL === undefined) throw new Error('baseURL is not configured');
  const profile = await mkdtemp(join(tmpdir(), 'toke-quota-'));
  const context = await chromium.launchPersistentContext(profile, {
    viewport: { width: 1440, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    // Far below one snapshot: the packed project alone is kilobytes.
    await cdp.send('Storage.overrideQuotaForOrigin', {
      origin: new URL(baseURL).origin,
      quotaSize: 1024,
    });
    await page.goto(baseURL);
    await expect(page.getByTestId('canvas-viewport')).toHaveAttribute('data-fonts-ready', 'true');

    const box = await page.getByTestId('canvas-viewport').boundingBox();
    if (box === null) throw new Error('viewport has no box');
    await page.getByTestId('tool-rect').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The autosave debounce is 2s; the write then fails inside IndexedDB.
    await page.getByTestId('open-diagnostics').click();
    await expect(page.getByTestId('diagnostics-entry')).toContainText(
      'Could not autosave: browser storage is full.',
      { timeout: 15_000 },
    );

    // And the editor carries on: the failure took nothing else down.
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
