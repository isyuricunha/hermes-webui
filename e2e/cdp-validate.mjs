import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Remote CDP validation (a remote Chrome over CDP):
 * renders the WebUI from a REAL remote browser over the tailnet and captures
 * the mobile UX evidence set. This is the real-device-style visual sign-off
 * path required by the mission — not the local Playwright Chromium.
 */

const CDP = 'http://100.64.234.49:49222';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR ?? 'e2e-output/ux-mobile';
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: 'cdp-settings-system-mobile-390', path: '/settings/system' },
  { name: 'cdp-settings-models-mobile-390', path: '/settings/models' },
  { name: 'cdp-settings-mcp-mobile-390', path: '/settings/mcp' },
  { name: 'cdp-settings-cron-mobile-390', path: '/settings/cron' },
  { name: 'cdp-chat-home-mobile-390', path: '/' },
];

const browser = await chromium.connectOverCDP(CDP);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

for (const shot of shots) {
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log('captured:', shot.name);
}

await context.close();
await browser.close();
console.log('cdp validation done');
