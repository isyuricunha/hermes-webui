import { chromium } from '@playwright/test';

const CDP = 'http://100.64.234.49:49222';
const BASE = 'http://100.78.106.99:5173';
const OUT = '/home/ubuntu/ella/reports/hermes-webui-rc1/chat-ux';

await new Promise((resolve) => setTimeout(resolve, 8000));
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
const ok = await page
  .screenshot({ path: `${OUT}/cdp-slash-menu-mobile-390.png`, animations: 'disabled', timeout: 25_000 })
  .then(() => true)
  .catch(() => false);
if (!ok) {
  const cdp = await context.newCDPSession(page);
  const frames = [];
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  cdp.on('Page.screencastFrame', (event) => {
    frames.push(event.data);
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
  });
  await page.waitForTimeout(2000);
  if (frames.length > 0) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${OUT}/cdp-slash-menu-mobile-390.png`, Buffer.from(frames[frames.length - 1], 'base64'));
  }
}
console.log('mobile slash captured');
await context.close().catch(() => undefined);
await browser.close();
