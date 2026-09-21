import { expect, test, type Page } from '@playwright/test';

/**
 * Top-level navigation (PRD 6.2): Settings must never be a dead end.
 *
 * Covers the navigation remediation contract:
 * - mobile: back-to-chat from the Settings top bar and from the Settings
 *   drawer entry; the active session must be restored, not recreated
 * - desktop: the Settings nav exposes a Chat destination; Back/Forward keeps
 *   normal browser semantics
 * - direct links to /settings/... still work and lead to normal Chat state
 * - no page-level horizontal overflow after navigating
 */

const waitForNoHorizontalOverflow = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth <= 2;
  });
};

/** Phase 1 auth: mutating API calls need the session CSRF token. */
async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const state = await page.request.get('/api/auth/state');
  const body = (await state.json()) as { csrfToken?: string };
  return body.csrfToken !== undefined ? { 'x-csrf-token': body.csrfToken } : {};
}

async function createRealSession(page: Page): Promise<string> {
  const headers = await csrfHeaders(page);
  const response = await page.request.post('/api/sessions', { headers, data: {} });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { session: { id: string } };
  return payload.session.id;
}

async function deleteSession(page: Page, sessionId: string): Promise<void> {
  const headers = await csrfHeaders(page);
  await page.request.delete(`/api/sessions/${sessionId}`, { headers });
}

test.describe('Settings is never a dead end', () => {
  test.describe('mobile (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('top bar back arrow restores the active session', async ({ page }) => {
      const sessionId = await createRealSession(page);
      try {
        await page.goto(`/chat/${sessionId}`);
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await page.waitForTimeout(400); // let ChatView remember the session

        // Enter Settings from the conversations drawer.
        await page.getByRole('button', { name: 'Open conversations' }).click();
        await page.getByRole('link', { name: 'Settings' }).click();
        await expect(page).toHaveURL(/\/settings/);

        // Back to Chat via the top bar arrow.
        await page.getByRole('button', { name: 'Back to Chat' }).click();
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await waitForNoHorizontalOverflow(page);
      } finally {
        await deleteSession(page, sessionId);
      }
    });

    test('drawer Chat entry closes the drawer and restores the session', async ({ page }) => {
      const sessionId = await createRealSession(page);
      try {
        await page.goto(`/chat/${sessionId}`);
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await page.waitForTimeout(400);

        await page.getByRole('button', { name: 'Open conversations' }).click();
        await page.getByRole('link', { name: 'Settings' }).click();
        await expect(page).toHaveURL(/\/settings/);

        // Open the Settings drawer and use the Chat destination.
        await page.getByRole('button', { name: 'Open Settings navigation' }).click();
        await page.getByRole('button', { name: '← Chat' }).click();
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await waitForNoHorizontalOverflow(page);
      } finally {
        await deleteSession(page, sessionId);
      }
    });
  });

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('nav Chat entry restores the session; Back/Forward stays sane', async ({ page }) => {
      const sessionId = await createRealSession(page);
      try {
        await page.goto(`/chat/${sessionId}`);
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await page.waitForTimeout(400);

        await page.getByRole('link', { name: 'Settings' }).click();
        await expect(page).toHaveURL(/\/settings/);

        // Desktop nav exposes the Chat destination directly.
        await page.getByRole('button', { name: '← Chat' }).click();
        await expect(page).toHaveURL(`/chat/${sessionId}`);

        // Browser history: Back returns to Settings, Forward returns to Chat.
        await page.goBack();
        await expect(page).toHaveURL(/\/settings/);
        await page.goForward();
        await expect(page).toHaveURL(`/chat/${sessionId}`);
        await waitForNoHorizontalOverflow(page);
      } finally {
        await deleteSession(page, sessionId);
      }
    });
  });

  test('direct /settings deep link leads to normal Chat home', async ({ page }) => {
    await page.goto('/settings/system');
    await expect(page).toHaveURL(/\/settings\/system/);
    await waitForNoHorizontalOverflow(page);

    // No remembered session in this fresh context: Chat destination goes home.
    await page.getByRole('button', { name: '← Chat' }).last().click();
    await expect(page).toHaveURL('/');
    await waitForNoHorizontalOverflow(page);
  });
});