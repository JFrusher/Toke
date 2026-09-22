import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the README screenshot only.
 *
 * Separate from playwright.config.ts so the capture never runs as part of the
 * test suite — it asserts nothing, and a CI failure because an image could not
 * be written would be noise.
 */
export default defineConfig({
  testDir: '.',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
