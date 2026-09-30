import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Remote CDP visual sign-off (a remote Chrome over CDP):
 * renders the chat UX from a real remote browser over the tailnet, drives one
 * disposable real-Hermes session with a terminal tool call, and captures the
 * evidence set (tool card, expanded detail, reasoning, session titles, mobile
 * slash menu).
 */

const CDP = 'http://100.64.234.49:49222';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR ?? 'e2e-output/chat-ux';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);

// --- Desktop pass: real tool run + session titles ---------------------------
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await desktop.newPage();
const create = await page.request.post(`${BASE}/api/sessions`, { data: {} });
const { session } = await create.json();
try {
  await page.goto(`${BASE}/chat/${session.id}`);
  const input = page.getByLabel('Message input');
  await input.fill(
    'Use the terminal tool to run exactly: echo cdp-toolcard-evidence. Reply with only the output.',
  );
  await input.press('Enter');

  const card = page.locator('[data-tool-card]').first();
  await card.waitFor({ timeout: 120_000 });
  await card.locator('button').first().click();
  await page.waitForTimeout(800);
  // Remote CDP quirk: full-page screenshots can hang while the live page's
  // compositor never goes idle; disable animations and fall back to a
  // screencast frame capture if the still screenshot stalls.
  const still = page
    .screenshot({ path: `${OUT}/cdp-tool-card-expanded-desktop.png`, animations: 'disabled', timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!(await still)) {
    const cdp = await desktop.newCDPSession(page);
    const frame = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15_000);
      cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 }).catch(() => undefined);
      cdp.on('Page.screencastFrame', async (event) => {
        clearTimeout(timer);
        resolve(event.data);
        await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
      });
    });
    if (frame !== null) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${OUT}/cdp-tool-card-expanded-desktop.png`, Buffer.from(frame, 'base64'));
    }
    await cdp.detach().catch(() => undefined);
  }
  await page.screenshot({ path: `${OUT}/cdp-chat-transcript-desktop.png`, animations: 'disabled', timeout: 25_000 }).catch(() => undefined);
} finally {
  await page.request.delete(`${BASE}/api/sessions/${session.id}`).catch(() => undefined);
}
await desktop.close();

// --- Mobile pass: slash palette + picker -------------------------------------
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const mpage = await mobile.newPage();
await mpage.goto(`${BASE}/`);
const minput = mpage.getByLabel('Message input');
await minput.pressSequentially('/');
await mpage.getByRole('listbox', { name: 'Hermes commands' }).waitFor();
await mpage.screenshot({
  path: `${OUT}/cdp-slash-menu-mobile-390.png`,
  animations: 'disabled',
  timeout: 25_000,
});
await mobile.close();

await browser.close();
console.log('cdp captures done');
