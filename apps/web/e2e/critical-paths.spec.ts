import { test, expect } from '@playwright/test';

/**
 * Critical-path smoke tests. These cover the user journeys that, if broken,
 * make the app unusable. Add new specs to other files; keep this one focused
 * on the absolute baseline.
 *
 * Auth strategy: tests use the dev quick-login buttons exposed when
 * NODE_ENV=development. Replace with a real seeded test user when wiring CI.
 */

test.describe('Critical paths', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/prime/i);
    await expect(page.getByText(/sign in|login/i).first()).toBeVisible();
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder dashboard loads after dev login', async ({ page }) => {
    await page.goto('/login');

    // Dev quick-login button (only available when NODE_ENV !== production)
    const founderLogin = page.getByRole('button', { name: /founder/i });
    if (await founderLogin.count()) {
      await founderLogin.first().click();
      await expect(page).toHaveURL(/\/dashboard\/founder/);
      await expect(page.getByText(/portfolio|projects/i).first()).toBeVisible({ timeout: 10_000 });
    } else {
      test.skip(true, 'Dev login buttons not exposed — set up seeded test user for CI');
    }
  });

  test('health endpoint returns ok', async ({ request }) => {
    const apiBase = process.env.API_BASE ?? 'http://localhost:3001';
    const res = await request.get(`${apiBase}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
