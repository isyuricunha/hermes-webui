import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config';
import { buildApp } from '../src/app';

/**
 * Phase 1 auth acceptance (spec 2.25/2.27): setup/claim, login, CSRF,
 * deny-by-default API policy, rate limiting and session lifecycle, exercised
 * through fastify.inject() against the real route tree.
 */

let dataDir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let ownerCookie: string;
let ownerCsrf: string;
const setupTokenFile = () => path.join(dataDir, 'setup-token');

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'hwui-auth-'));
  app = await buildApp({ dataDir, config: loadConfig({}) });
});

afterAll(() => {
  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function cookieFrom(response: { cookies: { name: string; value: string }[] }): string {
  const session = response.cookies.find((cookie) => cookie.name === 'hermes_webui_session');
  expect(session).toBeDefined();
  return `hermes_webui_session=${session?.value ?? ''}`;
}

describe('auth phase 1', () => {
  it('boots unclaimed with a setup token file (0600)', async () => {
    await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(fs.existsSync(setupTokenFile())).toBe(true);
    const mode = fs.statSync(setupTokenFile()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects setup with a wrong token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { setupToken: 'wrong-token', username: 'owner', password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('SETUP_TOKEN_INVALID');
  });

  it('claims the instance atomically; a second claim gets 409', async () => {
    const token = fs.readFileSync(setupTokenFile(), 'utf8').trim();
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        setupToken: token,
        username: 'Yuri',
        displayName: 'Yuri',
        password: 'correct-horse-battery',
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().authenticated).toBe(true);
    expect(fs.existsSync(setupTokenFile())).toBe(false);

    ownerCookie = cookieFrom(first);
    ownerCsrf = first.json().csrfToken;

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        setupToken: token,
        username: 'other',
        password: 'correct-horse-battery',
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SETUP_ALREADY_CLAIMED');
  });

  it('hides Hermes details from the public health endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'hermes-webui' });
  });

  it('returns 401 with AUTH_REQUIRED for protected APIs without a session', async () => {
    for (const url of ['/api/sessions', '/api/app/status', '/api/cron/jobs', '/api/settings/config']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code, url).toBe('AUTH_REQUIRED');
    }
  });

  it('rejects mutations without the CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: ownerCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTH_CSRF_INVALID');
  });

  it('rejects cross-origin mutations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: ownerCookie,
        'x-csrf-token': ownerCsrf,
        origin: 'https://evil.example',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTH_CSRF_INVALID');
  });

  it('logs in with valid credentials and wrong credentials are indistinguishable', async () => {
    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'yuri', password: 'correct-horse-battery' },
    });
    expect(good.statusCode).toBe(200);

    const badUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'does-not-exist', password: 'whatever-long-password' },
    });
    const badPass = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'yuri', password: 'wrong-password-123' },
    });
    expect(badUser.statusCode).toBe(401);
    expect(badPass.statusCode).toBe(401);
    expect(badUser.json().error.code).toBe(badPass.json().error.code);
  });

  it('rate limits repeated login failures', async () => {
    const unknownUser = `probe-${Date.now()}@x`;
    let last: Awaited<ReturnType<typeof app.inject>> | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: unknownUser, password: 'whatever-long-password' },
      });
    }
    expect(last).not.toBeNull();
    expect(last?.statusCode).toBe(429);
    expect(last?.json().error.code).toBe('AUTH_RATE_LIMITED');
    expect(last?.headers['retry-after']).toBeDefined();
  });

  it('authenticated session reaches protected APIs; logout kills the session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'yuri', password: 'correct-horse-battery' },
    });
    const cookie = cookieFrom(login);
    const csrf = login.json().csrfToken;

    const status = await app.inject({
      method: 'GET',
      url: '/api/app/status',
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, 'x-csrf-token': csrf },
    });
    expect(signOut.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/app/status',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('auth state reports authenticated with a valid session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'yuri', password: 'correct-horse-battery' },
    });
    const cookie = cookieFrom(login);
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect(state.statusCode).toBe(200);
    const body = state.json();
    expect(body.authenticated).toBe(true);
    expect(body.csrfToken).toBeDefined();
    expect(body.user.username).toBe('Yuri');
  });

  it('keeps the /api/* surface deny-by-default (allowlist enumeration)', async () => {
    const publicAllowlist = new Set([
      'GET /api/healthz',
      'GET /api/auth/state',
      'POST /api/auth/setup',
      'POST /api/auth/login',
    ]);
    const routes = (app as unknown as { apiRouteInventory: { method: string; url: string }[] })
      .apiRouteInventory;
    expect(routes.length).toBeGreaterThan(10);
    type Injected = { statusCode: number; headers: Record<string, unknown>; json(): { error?: { code?: string } } };
    for (const route of routes) {
      if (route.method === 'OPTIONS' || route.method === 'HEAD') continue;
      const key = `${route.method} ${route.url}`;
      const response = (await app.inject({
        method: route.method as 'GET',
        url: route.url,
      })) as unknown as Injected;
      if (publicAllowlist.has(key)) {
        expect(response.statusCode, `${key} must stay public`).not.toBe(401);
      } else {
        expect(response.statusCode, `${key} must require auth`).toBe(401);
      }
    }
  });
});

describe('auth regression coverage (planner review)', () => {
  let dataDir2: string;
  let app2: Awaited<ReturnType<typeof buildApp>>;
  let ownerCookie: string;
  let ownerCsrf: string;
  let dbFile: string;

  beforeAll(async () => {
    dataDir2 = mkdtempSync(path.join(tmpdir(), 'hwui-auth-reg-'));
    dbFile = path.join(dataDir2, 'webui.sqlite3');
    app2 = await buildApp({
      dataDir: dataDir2,
      config: loadConfig({ HERMES_WEBUI_TRUST_PROXY: '127.0.0.1' }),
    });
    const token = fs.readFileSync(path.join(dataDir2, 'setup-token'), 'utf8').trim();
    const setup = await app2.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { setupToken: token, username: 'owner', password: 'correct-horse-battery' },
    });
    expect(setup.statusCode).toBe(200);
    ownerCookie = cookieFrom(setup);
    ownerCsrf = setup.json().csrfToken;
  });

  afterAll(() => {
    app2.close();
    fs.rmSync(dataDir2, { recursive: true, force: true });
  });

  it('expired reauth window rejects a recent-only route', async () => {
    // Drive reauth_until into the past directly in the session store.
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(dbFile);
    raw.prepare('UPDATE sessions SET reauth_until = ? WHERE revoked_at IS NULL').run(1);
    raw.close();

    const response = await app2.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: ownerCookie, 'x-csrf-token': ownerCsrf },
      payload: { currentPassword: 'correct-horse-battery', newPassword: 'another-long-password-1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_REAUTH_REQUIRED');
  });

  it('sessions of another user are not revocable (404, no oracle)', async () => {
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(dbFile);
    const now = Date.now();
    raw
      .prepare(
        `INSERT INTO users (id, username, username_normalized, password_hash, role, created_at, updated_at, password_changed_at)
         VALUES ('other-user', 'other', 'other', 'x', 'member', ?, ?, ?)`,
      )
      .run(now, now, now);
    raw
      .prepare(
        `INSERT INTO sessions (id, token_hash, user_id, csrf_token, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ('other-session', 'other-hash', 'other-user', 'other-csrf', ?, ?, ?, ?)`,
      )
      .run(now, now, now + 86_400_000, now + 86_400_000);
    raw.close();

    const response = await app2.inject({
      method: 'DELETE',
      url: '/api/auth/sessions/other-session',
      headers: { cookie: ownerCookie, 'x-csrf-token': ownerCsrf },
    });
    expect(response.statusCode).toBe(404);
  });

  it('trusted proxy HTTPS marks the session cookie Secure; direct HTTP does not', async () => {
    const login = await app2.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password: 'correct-horse-battery' },
      headers: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' },
    });
    const setCookie = login.headers['set-cookie'];
    const secureCookie = [].concat(setCookie as never).join(' ');
    expect(secureCookie).toContain('Secure');
    await app2.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieFrom(login), 'x-csrf-token': login.json().csrfToken },
    });

    const direct = await app2.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password: 'correct-horse-battery' },
    });
    const plain = [].concat(direct.headers['set-cookie'] as never).join(' ');
    expect(plain).not.toContain('Secure');
    const directCookie = cookieFrom(direct);
    const csrf = direct.json().csrfToken;
    await app2.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: directCookie, 'x-csrf-token': csrf },
    });
  });

  it('password change revokes every old session and keeps the current one', async () => {
    const owner = cookieFrom(
      await app2.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'owner', password: 'correct-horse-battery' },
      }),
    );
    // A second session for the same user.
    const second = await app2.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password: 'correct-horse-battery' },
    });
    const secondCookie = cookieFrom(second);

    const change = await app2.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: secondCookie, 'x-csrf-token': second.json().csrfToken },
      payload: { currentPassword: 'correct-horse-battery', newPassword: 'another-long-password-1' },
    });
    expect(change.statusCode).toBe(200);

    // The older session must now be dead; the fresh cookie works.
    const oldSession = await app2.inject({
      method: 'GET',
      url: '/api/app/status',
      headers: { cookie: owner },
    });
    expect(oldSession.statusCode).toBe(401);
    const fresh = await app2.inject({
      method: 'GET',
      url: '/api/app/status',
      headers: { cookie: cookieFrom(change) },
    });
    expect(fresh.statusCode).toBe(200);
  });
});
