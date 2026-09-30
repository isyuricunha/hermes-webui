import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * UX evidence capture (not a test): representative screenshots of the
 * responsive remediation, mobile 390px + desktop reference.
 * Run: node --experimental-strip-types scripts/ux-evidence.mts? — plain JS
 * inline via Playwright's chromium.
 */

const OUT = process.env.OUT_DIR ?? 'e2e-output/ux-mobile';
mkdirSync(OUT, { recursive: true });

const BASE = 'http://127.0.0.1:5173';
const shots = [
  { name: 'settings-models-mobile-390', path: '/settings/models', mobile: true },
  { name: 'settings-mcp-mobile-390', path: '/settings/mcp', mobile: true },
  { name: 'settings-skills-mobile-390', path: '/settings/skills', mobile: true },
  { name: 'settings-system-mobile-390', path: '/settings/system', mobile: true },
  { name: 'settings-rawconfig-mobile-390', path: '/settings/advanced/config', mobile: true },
  { name: 'settings-environment-mobile-390', path: '/settings/advanced/environment', mobile: true },
  { name: 'settings-cli-mobile-390', path: '/settings/advanced/cli', mobile: true },
  { name: 'chat-home-mobile-390', path: '/', mobile: true },
  { name: 'settings-models-desktop-1440', path: '/settings/models', mobile: false },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const ctx = await browser.newContext({
    viewport: shot.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: false });
  await ctx.close();
  console.log('captured:', shot.name);
}
await browser.close();
console.log('done');
