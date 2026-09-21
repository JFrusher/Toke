import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Capped rather than left to the CPU count. Every spec boots a SQLite WASM
  // worker, runs migrations and imports a CSV; four of those against a single
  // Turbopack dev server contend badly enough to time out assertions that
  // pass comfortably in isolation.
  workers: isCI ? 1 : 2,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Raised from the 5s default for the same reason: these are real waits on
  // a worker and a database, not on a render.
  expect: { timeout: 15_000 },
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
