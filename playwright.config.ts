import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Conditionally spread rather than `workers: isCI ? 1 : undefined`.
  // exactOptionalPropertyTypes (tsconfig, CLAUDE.md §3) rejects an explicit
  // `undefined` for an optional property — omitting the key is the correct
  // way to say "use the default".
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  // Single Chromium target. toke is a desktop studio (CLAUDE.md §4.7); there is
  // no mobile layout to test, and cross-browser surface is not where the risk
  // lives — canvas geometry and PDF output are.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
