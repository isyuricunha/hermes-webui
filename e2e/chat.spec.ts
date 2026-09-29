import { expect, test } from '@playwright/test';
import { loginViaApi } from './helpers/auth';


/**
 * E2E against the REAL Hermes gateway on this host (no mocks): sends a real
 * message, expects real streaming and a real persisted session.
 *
 * Creates one throwaway session ("webui-e2e") and deletes it at the end.
 */

const MARKER = `webui-e2e ${Date.now()}`;

test.describe.serial('chat over real Hermes', () => {
  let sessionId: string | null = null;

  // Accept the delete confirmation dialog.
  test.beforeEach(async ({ context }) => {
    context.on('dialog', (dialog) => void dialog.accept());
  });

  test('opens into the chat home', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
    await expect(page.getByText('Hermes: Connected')).toBeVisible();
  });

  test('sends a message and receives a real streamed response', async ({ page }) => {
    await loginViaApi(page);
    await page.goto('/');
    const composer = page.getByLabel('Message input');
    await composer.fill(`Responda apenas: ${MARKER} ok`);
    await composer.press('Enter');

    // The URL moves to the real session and the user message appears.
    await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 });
    sessionId = page.url().split('/chat/')[1] ?? null;
    expect(sessionId).toBeTruthy();

    // A real streamed assistant reply arrives (LLM round-trip).
    await expect(
      page.locator('article').filter({ hasText: 'ok' }).first(),
    ).toBeVisible({ timeout: 90_000 });
  });

  test('the session persists in Hermes and reopens with history', async ({ page }) => {
    test.skip(sessionId === null, 'previous step failed');
    await loginViaApi(page);
    await page.goto(`/chat/${sessionId}`);
    await expect(page.getByText(MARKER).first()).toBeVisible();
    // Reload during idle: history still comes from Hermes.
    await page.reload();
    await expect(page.getByText(MARKER).first()).toBeVisible();
  });

  test('sidebar lists the session and delete removes it', async ({ page }) => {
    test.skip(sessionId === null, 'previous step failed');
    await loginViaApi(page);
    await page.goto('/');
    const listItem = page.locator('li').filter({ has: page.getByRole('link', { name: MARKER }) }).first();
    await expect(listItem).toBeVisible();

    // Action buttons reveal on hover/focus (group-hover / group-focus-within).
    await listItem.hover();
    await listItem.getByRole('button', { name: /Delete/ }).click();

    // Confirm dialog is accepted by the context handler below.
    await expect(listItem).toBeHidden({ timeout: 15_000 });
    sessionId = null;
  });
});
