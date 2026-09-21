import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:8795';
const E2E_DATA_DIR = '/tmp/hwui-e2e-data';

// Clean slate.
fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
const { spawn } = await import('node:child_process');
const server = spawn('node', ['dist/main.js'], {
  cwd: new URL('.', 'file:///home/ubuntu/ella-repos/hermes-webui/apps/server/').pathname,
  env: { ...process.env, PORT: '8795', HOST: '127.0.0.1', HERMES_WEBUI_DATA_DIR: E2E_DATA_DIR },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 2500));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR EARLY:', String(err).slice(0, 400)));
  page.on('response', (response) => {
    if (response.url().includes('/api/')) {
      console.log('NET:', response.request().method(), response.url().split('8795')[1], '->', response.status());
    }
  });
  page.on('requestfailed', (request) => {
    console.log('REQFAILED:', request.method(), request.url().split('8795')[1], request.failure()?.errorText);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('error') || text.includes('Error') || msg.type() === 'error' || text.includes('Minified') || text.includes(' Catch')) {
      console.log('CONSOLE-' + msg.type().toUpperCase() + ':', text.slice(0, 300));
    }
  });
page.on('console', (msg) => {
  if (msg.text().includes('csrf-debug')) console.log('BROWSER:', msg.text());
});
page.on('response', (response) => {
  if (response.url().includes('/api/cli/')) {
    console.log('RESPONSE:', response.request().method(), response.url().split('8795')[1], '->', response.status());
  }
});

await page.goto(`${BASE}/setup`);
console.log('url após goto:', page.url());
await page.screenshot({ path: '/tmp/debug-setup.png' }).catch(() => undefined);
console.log('pathname real:', await page.evaluate(() => window.location.pathname));
console.log('body:', (await page.locator('body').innerText()).slice(0, 300));

const token = fs.readFileSync(path.join(E2E_DATA_DIR, 'setup-token'), 'utf8').trim();
await page.getByLabel('Setup token').fill(token);
await page.getByLabel('Username').fill('probe');
await page.getByLabel('Password', { exact: true }).fill('probe-password-123');
await page.getByLabel('Confirm password').fill('probe-password-123');
await page.getByRole('button', { name: 'Create owner account' }).click();
await page.waitForURL(`${BASE}/`);
console.log('setup ok, redirecionado para home');

await page.goto(`${BASE}/settings/advanced/cli`);
page.on('pageerror', (err) => console.log('PAGEERROR:', String(err).slice(0, 200)));
  console.log('URL cli:', page.url());
  console.log('body cli vazio, tirando screenshot...');
  await page.screenshot({ path: '/tmp/cli-blank.png', fullPage: true });
await page.waitForTimeout(8000);

await browser.close();
server.kill('SIGTERM');
console.log('done');
