import { expect, test } from '@playwright/test';
import { loginViaApi } from './helpers/auth';


/** Mobile is first-class (PRD 55): drawer navigation + composer usability. */
test.use({ viewport: { width: 390, height: 844 } });

test.describe('mobile', () => {
  test('drawer opens, navigates and the composer stays usable', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Open conversations' }).click();
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    await expect(page.getByText('Hermes: Connected').or(page.getByText('Hermes: Offline'))).toBeVisible();

    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    // Drawer closed, chat still visible.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const composer = page.getByLabel('Message input');
    await composer.scrollIntoViewIfNeeded();
    await composer.fill('teste mobile');
    expect(await composer.inputValue()).toBe('teste mobile');
  });
});
