import { expect, test, type Page } from '@playwright/test';
import { createRealSession, deleteSession, loginViaApi } from './helpers/auth';

/**
 * Chat UX E2E against the real Hermes-backed dev WebUI:
 * slash command discoverability, native /model picker (never an LLM message),
 * native navigation commands, tool cards, system command cards, derived
 * session titles, and mobile usability — including no page-level overflow.
 *
 * Real-run flows use one disposable session created and deleted by the spec.
 * Each test authenticates via the API so a sign-out in any spec cannot poison
 * the shared storage state of the following specs.
 */

const TOOL_ECHO = 'hello-webui-toolcard';

test.beforeEach(async ({ page }) => {
  await loginViaApi(page);
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth <= 2;
  });
}

test.describe('slash command discoverability', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('typing / opens the palette and /mod filters to /model', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('Message input');
    await input.click();
    await input.pressSequentially('/');
    const menu = page.getByRole('listbox', { name: 'Hermes commands' });
    await expect(menu).toBeVisible();
    // Native commands are labeled as WebUI, unsupported ones still listed.
    await expect(menu).toContainText('/new');

    await input.pressSequentially('mod');
    await expect(menu).toContainText('/model');
    await expect(menu).not.toContainText('/new');
    await expectNoHorizontalOverflow(page);
  });

  test('/model opens the picker, never an LLM message; cancel keeps state', async ({ page }) => {
    const sessionId = await createRealSession(page);
    try {
      await page.goto(`/chat/${sessionId}`);
      const input = page.getByLabel('Message input');
      await input.pressSequentially('/model');
      await page.getByRole('option', { name: /^\/model/ }).click();

      const picker = page.getByRole('dialog', { name: 'Model picker' });
      await expect(picker).toBeVisible();
      // Operator UI: real catalog, provider -> model steps, scope info.
      await expect(picker).toContainText('Session model');
      await expect(picker).toContainText(/session lock|global default/i);
      await expect(picker).not.toContainText('ella/ella-large-5-2');
      // No user message was created for the slash command.
      await expect(page.locator('article')).toHaveCount(0);

      await picker.getByRole('button', { name: 'Close model picker' }).click();
      await expect(picker).not.toBeVisible();
      await expectNoHorizontalOverflow(page);
    } finally {
      await deleteSession(page, sessionId);
    }
  });

  test('/settings navigates natively; /sessions opens the sidebar', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('Message input');
    await input.fill('/settings');
    await page.getByRole('option', { name: /\/settings/ }).click();
    await expect(page).toHaveURL(/\/settings/);

    await page.goto('/');
    await input.fill('/sessions');
    await page.getByRole('option', { name: /\/sessions/ }).click();
    await expect(page.getByRole('complementary', { name: 'Conversations' })).toBeVisible();
  });

  test('unsupported commands render a system card, not an LLM message', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('Message input');
    await input.pressSequentially('/compact');
    await page.getByRole('option', { name: /^\/compact/ }).click();
    const card = page.locator('[data-system-card]');
    await expect(card).toContainText('/compact is unavailable in the WebUI');
    await expect(page.locator('article')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('real tool run', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('tool renders as a compact card and expands on demand', async ({ page }) => {
    test.setTimeout(180_000);
    const sessionId = await createRealSession(page);
    try {
      await page.goto(`/chat/${sessionId}`);
      const input = page.getByLabel('Message input');
      await input.fill(
        `Use the terminal tool to run exactly: echo ${TOOL_ECHO}. Reply with only the command output.`,
      );
      await input.press('Enter');

      // The tool call renders as a compact card (collapsed by default).
      const card = page.locator('[data-tool-card]').first();
      await expect(card).toBeVisible({ timeout: 120_000 });
      const expandedText = card.locator('pre');
      await expect(expandedText).toHaveCount(0); // nothing expanded inline

      await card.locator('button').first().click();
      await expect(card.locator('pre')).toBeVisible();

      // The transcript never dumps a giant serialized JSON blob inline.
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('{"tool"');
      await expectNoHorizontalOverflow(page);

      // Derived title: the sidebar shows the human title, not the raw id.
      // (Desktop: the conversations sidebar is already visible.)
      const sidebar = page.getByRole('complementary', { name: 'Conversations' });
      await expect(sidebar).toContainText(/echo|Use the terminal/i);
      await expect(sidebar.getByRole('link', { name: new RegExp(sessionId) })).toHaveCount(0);
    } finally {
      await deleteSession(page, sessionId);
    }
  });
});

test.describe('mobile chat ux', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('slash palette and cards fit the viewport without overflow', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('Message input');
    await input.fill('/');
    const menu = page.getByRole('listbox', { name: 'Hermes commands' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(390);
    await expectNoHorizontalOverflow(page);

    // Dismiss the menu, open the model picker via the composer chip.
    await page.getByLabel('Message input').press('Escape');
    await page.getByRole('button', { name: 'Change model' }).click();
    await expect(page.getByRole('dialog', { name: 'Model picker' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
