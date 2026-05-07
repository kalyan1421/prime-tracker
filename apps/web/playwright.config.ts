import { defineConfig, devices } from '@playwright/test';

/**
 * Prime Tracker E2E config.
 *
 * Run:
 *   pnpm --filter @prime-tracker/web exec playwright install   (first time)
 *   pnpm --filter @prime-tracker/web exec playwright test
 *
 * Tests assume API + web are running locally (or set BASE_URL env).
 * In CI: spin up via `webServer` block below — uncomment when CI is wired.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Uncomment for CI to auto-start the dev servers:
  // webServer: [
  //   { command: 'pnpm --filter @prime-tracker/api dev', port: 3001, reuseExistingServer: !process.env.CI },
  //   { command: 'pnpm --filter @prime-tracker/web dev', port: 5173, reuseExistingServer: !process.env.CI },
  // ],
});
