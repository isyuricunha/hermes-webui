import { expect, test } from '@playwright/test';

/** Mobile is first-class (PRD 55): drawer navigation + composer usability. */
test.use({ viewport: { width: 390, height: 844 } });

test.describe('mobile', () => {
  test('drawer opens, navigates and the composer stays usable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Open conversations' }).click();
    await expect(page.getByRole('button', { name: '+ New chat' })).toBeVisible();
    await expect(page.getByText('Hermes: Connected').or(page.getByText('Hermes: Offline'))).toBeVisible();

    await page.getByRole('button', { name: '+ New chat' }).click();
    // Drawer closed, chat still visible.
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();

    const composer = page.getByLabel('Message input');
    await composer.scrollIntoViewIfNeeded();
    await composer.fill('teste mobile');
    expect(await composer.inputValue()).toBe('teste mobile');
  });
});
