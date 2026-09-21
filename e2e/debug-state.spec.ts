import { test, expect } from '@playwright/test';

test('debug cookies and state', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const cookies = (await page.context().cookies()).filter((c) => c.name === 'hermes_webui_session');
  console.log('COOKIE-IN-CONTEXT:', JSON.stringify(cookies.map((c) => ({ name: c.name, value: c.value.slice(0, 8), expires: c.expires }))));
  const state = await page.evaluate(async () => {
    const response = await fetch('/api/auth/state');
    return await response.json();
  });
  console.log('STATE-IN-PAGE:', JSON.stringify(state));
  expect(cookies.length).toBeGreaterThan(0);
});
