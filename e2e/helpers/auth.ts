import { expect, type Page } from '@playwright/test';

/**
 * E2E auth helper: each test logs in via the API with the dedicated E2E
 * owner, so a test's sign-out never poisons the shared storage state of the
 * following specs. Cookies land in the page's browser context.
 */
export const E2E_OWNER = {
  username: 'webui-e2e-owner',
  password: 'webui-e2e-owner-pass-123',
};

export async function loginViaApi(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/login', {
    data: E2E_OWNER,
  });
  expect(response.ok()).toBeTruthy();
}

/** CSRF headers for mutating API calls from specs (cleanup etc.). */
export async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const state = await page.request.get('/api/auth/state');
  const body = (await state.json()) as { csrfToken?: string };
  return body.csrfToken !== undefined ? { 'x-csrf-token': body.csrfToken } : {};
}

export async function createRealSession(page: Page): Promise<string> {
  const headers = await csrfHeaders(page);
  const response = await page.request.post('/api/sessions', { headers, data: {} });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { session: { id: string } };
  return payload.session.id;
}

export async function deleteSession(page: Page, sessionId: string): Promise<void> {
  const headers = await csrfHeaders(page);
  await page.request.delete(`/api/sessions/${sessionId}`, { headers });
}
