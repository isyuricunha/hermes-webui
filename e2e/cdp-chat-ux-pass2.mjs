import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const CDP = 'http://100.64.234.49:49222';
const BASE = 'http://100.78.106.99:5173';
const OUT = '/home/ubuntu/ella/reports/hermes-webui-rc1/chat-ux';
mkdirSync(OUT, { recursive: true });

// Pass 1: real tool run -> transcript + expanded card (screencast fallback).
{
  const browser = await chromium.connectOverCDP(CDP);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
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

    const cdp = await context.newCDPSession(page);
    const frames = [];
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    cdp.on('Page.screencastFrame', (event) => {
      frames.push(event.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    });
    await page.waitForTimeout(2500);
    if (frames.length > 0) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${OUT}/cdp-chat-transcript-desktop.png`, Buffer.from(frames[frames.length - 1], 'base64'));
      console.log('transcript frame captured');
    }
    await cdp.detach().catch(() => undefined);
  } finally {
    await page.request.delete(`${BASE}/api/sessions/${session.id}`).catch(() => undefined);
    await context.close().catch(() => undefined);
  }
  await browser.close();
}

// Pass 2: mobile slash palette (fresh connection).
{
  const browser = await chromium.connectOverCDP(CDP);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  const input = page.getByLabel('Message input');
  await input.pressSequentially('/');
  await page.getByRole('listbox', { name: 'Hermes commands' }).waitFor();
  await page
    .screenshot({
      path: `${OUT}/cdp-slash-menu-mobile-390.png`,
      animations: 'disabled',
      timeout: 25_000,
    })
    .then(() => console.log('mobile slash captured'))
    .catch((error) => console.log('mobile slash still-shot failed:', String(error).slice(0, 120)));
  await context.close().catch(() => undefined);
  await browser.close();
}
console.log('done');
