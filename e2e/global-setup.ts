import type { FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Global E2E setup (Phase 1 auth): the dedicated test server (:8795, own data
 * directory, started by the webServer hook) boots unclaimed; this setup reads
 * the one-time token from disk, claims the instance with test-owner
 * credentials and saves an authenticated storage state for all specs.
 */

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? '8795'}`;
const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? '/tmp/hwui-e2e-data';
const OWNER = 'webui-e2e-owner';
const PASSWORD = 'webui-e2e-owner-pass-123';
const STORAGE = path.resolve('e2e/.auth/storage-state.json');

async function waitFor(check: string | (() => boolean), timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = typeof check === 'string' ? fetch(check).then((r) => r.ok) : Promise.resolve(check());
      if (await ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Condition not met within timeout');
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  fs.mkdirSync(path.dirname(STORAGE), { recursive: true });
  await waitFor(`${BASE}/healthz`, 30_000);

  const tokenFile = path.join(E2E_DATA_DIR, 'setup-token');
  await waitFor(() => fs.existsSync(tokenFile), 15_000).catch(() => undefined);
  if (!fs.existsSync(tokenFile)) {
    // Already claimed by a previous run: verify credentials still work.
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: OWNER, password: PASSWORD }),
    });
    if (!login.ok) {
      throw new Error('E2E instance is claimed and stored credentials do not work.');
    }
  }

  const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
  const setup = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupToken: token, username: OWNER, password: PASSWORD }),
  });
  if (!setup.ok && setup.status !== 409) {
    throw new Error(`E2E setup failed: HTTP ${setup.status}`);
  }

  // Authenticate (fresh session either way) and save the storage state.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: OWNER, password: PASSWORD }),
  });
  if (!login.ok) {
    throw new Error(`E2E login failed: HTTP ${login.status}`);
  }

  const rawCookies = login.headers.getSetCookie();
  fs.writeFileSync(
    STORAGE,
    JSON.stringify({
      cookies: rawCookies.map((cookie) => {
        const [pair] = cookie.split(';');
        const [name, value] = pair.split('=');
        return {
          name,
          value,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: cookie.toLowerCase().includes('httponly'),
          secure: false,
          sameSite: 'Lax',
        };
      }),
      origins: [],
    }),
  );
  console.log('global-setup: authenticated storage state saved.');
}
