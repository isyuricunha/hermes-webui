import { expect, test } from '@playwright/test';

/**
 * Auth user flows (Phase 1): sign out, sign back in, wrong-password error
 * handling and the account menu — desktop and mobile.
 */

const OWNER = { username: 'webui-e2e-owner', password: 'webui-e2e-owner-pass-123' };

test.describe('auth flows', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('sign out returns to login; wrong password never reveals user existence', async ({ page }) => {
    await page.goto('/settings/system');
    await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();

    // Sign out via the account menu.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Wrong password: generic error, no user enumeration.
    await page.getByLabel('Username').fill(OWNER.username);
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid username or password/i);

    // Correct password gets back in.
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/(settings|chat|$)/);
  });
});

test.describe('mobile login', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('login page is usable at mobile width without overflow', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Hermes' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await page.waitForFunction(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth <= 2;
    });
  });
});
