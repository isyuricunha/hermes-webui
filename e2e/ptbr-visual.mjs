#!/usr/bin/env node
/**
 * PT-BR visual evidence for the full i18n pass: screenshots of the real
 * deployed login (51372) and of the chat + settings pages served by a scratch
 * server (:8796, local auth, fake gateway :8643) with locale pt-BR.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const LOCALE = process.env.LOCALE ?? 'pt-BR';
const PT = LOCALE.toLowerCase().startsWith('pt');
const OUT = `e2e-output/i18n-${LOCALE}`;
mkdirSync(OUT, { recursive: true });

const SESSION_ID = '20261002_194913_558a0930';
const DATA_DIR = '/tmp/hwui-ptbr-visual';
let nextId = 100;
const rows = [
  {
    id: 100,
    session_id: SESSION_ID,
    role: 'user',
    content: PT
      ? 'Bom dia, Yuri. O deploy de ontem fechou.'
      : 'Good morning, Yuri. Yesterday’s deploy landed.',
    timestamp: Date.now() / 1000 - 3600,
    reasoning: null,
    tool_calls: null,
    active: 1,
  },
  {
    id: 101,
    session_id: SESSION_ID,
    role: 'assistant',
    content: PT
      ? 'Bom dia! Fechou: sync validado, pipeline verde e deploy no ar.'
      : 'Morning! It landed: sync validated, pipeline green and the deploy is live.',
    timestamp: Date.now() / 1000 - 3500,
    reasoning: null,
    tool_calls: null,
    active: 1,
  },
];

const fake = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    return send(200, {
      object: 'list',
      data: [
        {
          id: SESSION_ID,
          title: null,
          source: 'telegram',
          model: null,
          started_at: Date.now() / 1000 - 86400,
          message_count: rows.length,
          last_active: Date.now() / 1000 - 60,
        },
      ],
    });
  }
  if (url.pathname === `/api/sessions/${SESSION_ID}/messages`) {
    const data = rows
      .filter((row) => row.active === 1)
      .slice(0, 500)
      .map(({ active: _active, ...rest }) => rest);
    return send(200, { object: 'list', data });
  }
  if (url.pathname === '/_ptbr/inject' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      nextId += 1;
      rows.push({
        id: nextId,
        session_id: SESSION_ID,
        role: parsed.role ?? 'user',
        content: parsed.content ?? `injetada ${nextId}`,
        timestamp: Date.now() / 1000,
        reasoning: null,
        tool_calls: null,
        active: 1,
      });
      send(200, { ok: true, id: nextId });
    });
    return;
  }
  send(404, { error: { message: 'not found' } });
});
fake.listen(8643, '127.0.0.1');
console.log('fake gateway on :8643');

const server = spawn('node', ['apps/server/dist/main.js'], {
  env: {
    ...process.env,
    PORT: '8796',
    HOST: '127.0.0.1',
    HERMES_WEBUI_DATA_DIR: DATA_DIR,
    HERMES_WEBUI_AUTH_MODE: 'local',
    WEB_DIST_DIR: path.resolve('apps/web/dist'),
    HERMES_BASE_URL: 'http://127.0.0.1:8643',
    HERMES_API_SERVER_KEY: 'ptbr-visual-dummy',
    LOG_LEVEL: 'warn',
  },
  stdio: 'ignore',
});

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = typeof check === 'string' ? (await fetch(check)).ok : check();
      if (ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('not ready');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const base = 'http://127.0.0.1:8796';
  await waitFor(`${base}/healthz`, 30_000);
  await waitFor(() => existsSync(path.join(DATA_DIR, 'setup-token')), 15_000).catch(
    () => undefined,
  );
  const token = existsSync(path.join(DATA_DIR, 'setup-token'))
    ? readFileSync(path.join(DATA_DIR, 'setup-token'), 'utf8').trim()
    : '';
  await fetch(`${base}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      setupToken: token,
      username: 'ptbr-owner',
      password: 'ptbr-visual-pass-123',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ptbr-owner', password: 'ptbr-visual-pass-123' }),
  });
  const cookies = login.headers.getSetCookie().map((cookie) => {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    return { name, value, domain: '127.0.0.1', path: '/' };
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: LOCALE,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // 1) Chat view in PT-BR (fake telegram session, two bubbles).
  await page.goto(`${base}/chat/${SESSION_ID}`);
  await page
    .getByText(
      PT
        ? 'Bom dia, Yuri. O deploy de ontem fechou.'
        : 'Good morning, Yuri. Yesterday’s deploy landed.',
    )
    .waitFor({ timeout: 15_000 });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/chat-${LOCALE}.png` });

  // 2) Inject a Telegram-side message while the chat is open; the poll picks it up.
  await fetch('http://127.0.0.1:8643/_ptbr/inject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'user',
      content: PT
        ? 'Enviado pelo Telegram com o chat aberto no WebUI.'
        : 'Sent from Telegram with the WebUI chat open.',
    }),
  });
  await page
    .getByText(
      PT
        ? 'Enviado pelo Telegram com o chat aberto no WebUI.'
        : 'Sent from Telegram with the WebUI chat open.',
    )
    .waitFor({ timeout: 8_000 });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/chat-${LOCALE}-injected.png` });

  // 3) Models settings page in PT-BR (chrome translated; catalog errors stay honest).
  await page.goto(`${base}/settings/models`);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/settings-models-${LOCALE}.png` });

  // 4) Appearance page in PT-BR.
  await page.goto(`${base}/settings/appearance`);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/settings-appearance-${LOCALE}.png` });

  await browser.close();

  // 5) The REAL deployed instance (:51372): login page in PT-BR.
  const browser2 = await chromium.launch();
  const ctx2 = await browser2.newContext({
    viewport: { width: 1280, height: 800 },
    locale: LOCALE,
  });
  const page2 = await ctx2.newPage();
  await page2.goto('http://100.78.106.99:51372/login');
  await sleep(800);
  await page2.screenshot({ path: `${OUT}/deployed-login-${LOCALE}.png` });
  await browser2.close();

  console.log(`i18n visual evidence done (${LOCALE}):`, OUT);
} finally {
  server.kill();
}
