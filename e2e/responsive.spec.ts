import { expect, test, type Page } from '@playwright/test';

/**
 * Responsive shell audit (PRD 55 + UX remediation goal): every Settings page
 * must render without document-level horizontal overflow at phone widths,
 * with the drawer as the navigation surface. Viewport matrix covers the
 * common phone widths plus tablet and desktop references.
 */

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
] as const;

const SETTINGS_PAGES = [
  { path: '/settings/models', mustContain: 'Main model' },
  { path: '/settings/mcp', mustContain: 'cloudflare' },
  { path: '/settings/skills', mustContain: 'algorithmic-art' },
  { path: '/settings/cron', mustContain: 'cron' },
  { path: '/settings/messaging', mustContain: 'Telegram' },
  { path: '/settings/system', mustContain: 'Restart Hermes' },
  { path: '/settings/advanced/config', mustContain: 'model:' },
  { path: '/settings/advanced/environment', mustContain: 'Environment' },
  { path: '/settings/advanced/cli', mustContain: 'lsp.status' },
] as const;

async function assertNoHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
}

test.describe('settings mobile viewport matrix', () => {
  for (const viewport of VIEWPORTS) {
    test(`no horizontal overflow at ${viewport.name}px across all settings pages`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      const failures: string[] = [];

      for (const settingsPage of SETTINGS_PAGES) {
        await page.goto(settingsPage.path);
        // Content loads via async fetches; wait for the marker to appear.
        // CSS text-transform (uppercase labels) affects innerText, so
        // compare case-insensitively.
        await expect
          .poll(
            () => page.locator('body').innerText().then((t) => t.toLowerCase()),
            { timeout: 30_000 },
          )
          .toContain(settingsPage.mustContain.toLowerCase());
        const overflow = await assertNoHorizontalOverflow(page);
        if (overflow > 2) {
          failures.push(`${settingsPage.path}: overflow ${overflow}px`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`Overflow/render failures at ${viewport.name}px:\n${failures.join('\n')}`);
      }
      await context.close();
    });
  }

  test('drawer navigation works at 390px: open, select, closes', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/settings/models');

    // Drawer opens from the mobile top bar hamburger.
    await page.getByRole('button', { name: 'Open Settings navigation' }).click();
    const nav = page.getByRole('navigation', { name: 'Settings' });
    await expect(nav).toBeVisible();
    await expect(page.getByLabel('Search settings')).toBeVisible();

    // Selecting a destination closes the drawer.
    await nav.getByRole('link', { name: 'System' }).click();
    await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Settings navigation' })).toBeVisible();

    // Content occupies the full mobile viewport (no squeezed column).
    const contentWidth = await page
      .locator('main')
      .evaluate((main) => main.getBoundingClientRect().width);
    const viewportWidth = 390;
    expect(contentWidth).toBeGreaterThan(viewportWidth * 0.8);

    await context.close();
  });

  test('settings search on mobile navigates to the field editor', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/settings/cron');

    await page.getByRole('button', { name: 'Open Settings navigation' }).click();
    const search = page.getByLabel('Search settings');
    await search.fill('memory.nudge_interval');
    await page.getByRole('button', { name: /Memory → Nudge Interval/ }).click();

    await expect(page.getByRole('heading', { name: 'memory.nudge_interval' })).toBeVisible();
    await context.close();
  });
});

test.describe('desktop regression', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('desktop keeps the persistent two-pane settings layout', async ({ page }) => {
    await page.goto('/settings/models');
    await expect(page.getByText('Main model').first()).toBeVisible({ timeout: 30_000 });
    // Navigation column is persistent (not behind a hamburger).
    await expect(page.getByRole('button', { name: 'Open Settings navigation' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'System' })).toBeVisible();
    // Chat home is still the root.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
  });
});
