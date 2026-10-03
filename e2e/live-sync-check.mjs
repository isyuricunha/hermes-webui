#!/usr/bin/env node
/**
 * Live cross-surface sync check (option A: the chat message poll).
 *
 * Boots a FAKE gateway in-process that owns one session and can append
 * messages at runtime, starts the production server against it on a dedicated
 * port (:8796) with its own data directory, claims a local owner, then drives
 * the real UI: opens the session, injects a user message and an assistant
 * reply through the fake gateway and asserts the open chat picks both up via
 * the 2 s poll, rendering each exactly once (no duplication across polls).
 *
 * The dev instance (:5173/:8789) and the real gateway (:8642) are never
 * touched. Mirrors the auth flow of e2e/global-setup.ts.
 *
 * Usage: node e2e/live-sync-check.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_PORT = 8643;
const DATA_DIR = '/tmp/hwui-live-sync-data';
const SESSION_ID = '20261002_194913_558a0930';
const OWNER = 'live-sync-check';
const PASSWORD = 'live-sync-check-pass-123';
const OUT_DIR = 'e2e-output/live-sync';

mkdirSync(OUT_DIR, { recursive: true });
rmSync(DATA_DIR, { recursive: true, force: true });

// --- fake gateway -----------------------------------------------------------

const SESSION_ROW = {
  id: SESSION_ID,
  title: 'Live sync check',
  source: 'telegram',
  model: null,
  started_at: Date.now() - 86_400_000,
  message_count: 0,
  pinned: false,
  archived: false,
};

const rows = []; // { id, session_id, role, content, timestamp, reasoning, tool_calls }
let nextId = 100;

function addMessage(role, content) {
  const row = {
    id: nextId,
    session_id: SESSION_ID,
    role,
    content,
    timestamp: Date.now(),
    reasoning: null,
    tool_calls: null,
    active: 1,
  };
  nextId += 1;
  rows.push(row);
  SESSION_ROW.message_count = rows.filter((r) => r.active === 1).length;
  SESSION_ROW.last_active = Date.now();
  return row;
}

addMessage('user', 'PRE-EXISTING user message sent from Telegram');
addMessage('assistant', 'PRE-EXISTING assistant reply from Hermes');

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', FAKE_PORT ? `http://127.0.0.1:${FAKE_PORT}` : undefined);
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'POST' && url.pathname === '/_live-sync/inject') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const { role, content } = JSON.parse(body);
      send(200, addMessage(role, content));
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    send(200, { object: 'list', data: [SESSION_ROW] });
    return;
  }
  const messagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (request.method === 'GET' && messagesMatch) {
    if (decodeURIComponent(messagesMatch[1]) !== SESSION_ID) {
      send(404, { error: { message: 'unknown session' } });
      return;
    }
    const data = rows
      .filter((row) => row.active === 1)
      .slice(0, 500)
      .map(({ active: _active, ...rest }) => rest);
    send(200, { object: 'list', data });
    return;
  }
  send(404, {
    error: { message: `fake gateway has no route for ${request.method} ${url.pathname}` },
  });
});

await new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', resolve));
console.log(`fake gateway on :${FAKE_PORT}`);

// --- server under test ------------------------------------------------------

const serverProc = spawn('node', ['apps/server/dist/main.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    HERMES_WEBUI_DATA_DIR: DATA_DIR,
    HERMES_WEBUI_AUTH_MODE: 'local',
    WEB_DIST_DIR: new URL('../apps/web/dist', import.meta.url).pathname,
    HERMES_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
    HERMES_API_SERVER_KEY: 'dummy-live-sync-key',
    LOG_LEVEL: 'warn',
  },
  stdio: 'inherit',
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
  throw new Error(`Not ready: ${typeof check === 'string' ? check : '<condition>'}`);
}

try {
  await waitFor(`${BASE}/healthz`, 30_000);
  const tokenFile = `${DATA_DIR}/setup-token`;
  await waitFor(() => existsSync(tokenFile), 15_000);
  const setupToken = readFileSync(tokenFile, 'utf8').trim();
  const setup = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupToken, username: OWNER, password: PASSWORD }),
  });
  if (!setup.ok && setup.status !== 409) {
    throw new Error(`setup failed: HTTP ${setup.status}`);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: OWNER, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const cookies = login.headers.getSetCookie().map((cookie) => {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    return { name, value, domain: '127.0.0.1', path: '/' };
  });
  console.log('claimed and logged in');

  // --- drive the real UI ----------------------------------------------------

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(`${BASE}/chat/${SESSION_ID}`);

  const assertCount = async (text, expected) => {
    const count = await page.getByText(text).count();
    if (count !== expected) {
      throw new Error(`expected ${expected} occurrence(s) of "${text}", found ${count}`);
    }
  };

  await page.getByText('PRE-EXISTING assistant reply from Hermes').waitFor({ timeout: 15_000 });
  await assertCount('PRE-EXISTING user message sent from Telegram', 1);
  await assertCount('PRE-EXISTING assistant reply from Hermes', 1);
  await page.screenshot({ path: `${OUT_DIR}/before-injection.png` });
  console.log('state 1: both pre-existing messages render exactly once');

  // A message the user sends from Telegram while the chat is open in the UI.
  const injectedUser = addMessage('user', 'INJECTED user message sent from Telegram mid-view');
  const userVisibleAt = Date.now();
  await page
    .getByText('INJECTED user message sent from Telegram mid-view')
    .waitFor({ timeout: 8000 });
  console.log(
    `state 2: injected user message visible after ~${Date.now() - userVisibleAt}ms (row ${injectedUser.id})`,
  );
  await page.screenshot({ path: `${OUT_DIR}/after-user-injection.png` });

  // The assistant reply that follows it.
  const injectedAssistant = addMessage('assistant', 'INJECTED assistant reply received mid-view');
  const assistantVisibleAt = Date.now();
  await page.getByText('INJECTED assistant reply received mid-view').waitFor({ timeout: 8000 });
  console.log(
    `state 3: injected assistant reply visible after ~${Date.now() - assistantVisibleAt}ms (row ${injectedAssistant.id})`,
  );
  await page.screenshot({ path: `${OUT_DIR}/after-assistant-injection.png` });

  // Two more poll cycles must not duplicate anything.
  await page.waitForTimeout(5200);
  await assertCount('PRE-EXISTING user message sent from Telegram', 1);
  await assertCount('INJECTED user message sent from Telegram mid-view', 1);
  await assertCount('INJECTED assistant reply received mid-view', 1);
  await page.screenshot({ path: `${OUT_DIR}/after-two-more-polls.png` });
  console.log('state 4: after 2+ extra polls every message still renders exactly once');

  await browser.close();
  console.log('LIVE-SYNC CHECK: PASS');
} finally {
  serverProc.kill('SIGTERM');
  server.close();
}
