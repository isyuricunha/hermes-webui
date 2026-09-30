import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { buildApp } from '../src/app';
import { HermesIdentity, parseSetCookie } from '../src/hermes/identity';

/**
 * Auth mode "hermes": sign-in is verified by the Hermes dashboard's password
 * provider and the dashboard session it issues backs the WebUI's dashboard
 * API calls. The dashboard is faked at the fetch boundary.
 */

const DASHBOARD = 'http://dashboard.test';
const GOOD_USER = 'yuri';
const GOOD_PASS = 'correct horse battery staple';

interface FakeDashboard {
  fetch: typeof fetch;
  validAccess: Set<string>;
  seenBearers: string[];
  refreshCalls: number;
  down: boolean;
}

function fakeDashboard(): FakeDashboard {
  const state: FakeDashboard = {
    validAccess: new Set(['at-1']),
    seenBearers: [],
    refreshCalls: 0,
    down: false,
    fetch: (async () => new Response()) as typeof fetch,
  };
  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (state.down) {
      throw new TypeError('fetch failed');
    }
    const url = new URL(String(input));
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    if (url.pathname === '/auth/password-login') {
      if (body.provider !== 'basic') {
        return new Response(JSON.stringify({ detail: 'Unknown provider' }), { status: 404 });
      }
      if (body.username !== GOOD_USER || body.password !== GOOD_PASS) {
        return new Response(JSON.stringify({ detail: 'Invalid credentials' }), { status: 401 });
      }
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', 'hermes_session_at=at-1; HttpOnly; Max-Age=43200; Path=/; SameSite=lax');
      headers.append('set-cookie', 'hermes_session_rt=rt-1; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax');
      headers.append('set-cookie', 'hermes_session_provider=basic; Max-Age=2592000; Path=/; SameSite=lax');
      return new Response(JSON.stringify({ ok: true, next: '/' }), { status: 200, headers });
    }
    if (url.pathname === '/auth/native/refresh') {
      state.refreshCalls += 1;
      if (body.refresh_token !== 'rt-1') {
        return new Response(JSON.stringify({ error: 'session_expired' }), { status: 401 });
      }
      state.validAccess.add('at-2');
      return new Response(
        JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_at: 4_102_444_800 }),
        { status: 200 },
      );
    }
    if (url.pathname === '/api/config') {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      state.seenBearers.push(auth);
      const token = auth.replace(/^Bearer /, '');
      if (!state.validAccess.has(token)) {
        return new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ model: { default: 'model-large' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
  }) as typeof fetch;
  return state;
}

let dataDir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let dashboard: FakeDashboard;
let cookie: string;
let csrf: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'hwui-hermes-auth-'));
  dashboard = fakeDashboard();
  const config = loadConfig({ HERMES_DASHBOARD_URL: DASHBOARD });
  app = await buildApp({
    dataDir,
    config,
    hermesIdentity: new HermesIdentity(DASHBOARD, 'basic', { fetchImpl: dashboard.fetch }),
    dashboardFetch: dashboard.fetch,
  });
});

afterAll(() => {
  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('parseSetCookie', () => {
  it('reads name, value and Max-Age', () => {
    expect(parseSetCookie('hermes_session_at=abc.def; HttpOnly; Max-Age=60; Path=/')).toEqual({
      name: 'hermes_session_at',
      value: 'abc.def',
      maxAgeSeconds: 60,
    });
    expect(parseSetCookie('garbage')).toBeNull();
  });
});

describe('auth mode hermes', () => {
  it('defaults to hermes mode, is claimed and writes no setup token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(response.json()).toEqual({ claimed: true, mode: 'hermes', authenticated: false });
    expect(fs.existsSync(path.join(dataDir, 'setup-token'))).toBe(false);
  });

  it('refuses the local setup flow', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { setupToken: 'x', username: 'owner', password: 'long enough password' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('AUTH_NOT_SUPPORTED');
  });

  it('rejects credentials Hermes rejects, without a session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: GOOD_USER, password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(response.cookies.find((c) => c.name === 'hermes_webui_session')).toBeUndefined();
  });

  it('signs in with the Hermes credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: GOOD_USER, password: GOOD_PASS },
    });
    expect(response.statusCode).toBe(200);
    const session = response.cookies.find((c) => c.name === 'hermes_webui_session');
    expect(session).toBeDefined();
    cookie = `hermes_webui_session=${session?.value ?? ''}`;
    csrf = response.json().csrfToken as string;

    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect(state.json()).toMatchObject({ authenticated: true, mode: 'hermes', user: { username: GOOD_USER } });
  });

  it('calls the dashboard with the Hermes session and rotates it on expiry', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/settings/config', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    expect(dashboard.seenBearers.at(-1)).toBe('Bearer at-1');

    dashboard.validAccess.delete('at-1');
    const second = await app.inject({ method: 'GET', url: '/api/settings/config', headers: { cookie } });
    expect(second.statusCode).toBe(200);
    expect(dashboard.refreshCalls).toBe(1);
    expect(dashboard.seenBearers.at(-1)).toBe('Bearer at-2');
  });

  it('never exposes the dashboard tokens to the browser', async () => {
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect(state.body).not.toContain('at-2');
    expect(state.body).not.toContain('rt-2');
  });

  it('leaves password changes to Hermes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { currentPassword: GOOD_PASS, newPassword: 'another long password' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AUTH_NOT_SUPPORTED');
  });

  it('reports an unreachable dashboard as unavailable, not as bad credentials', async () => {
    dashboard.down = true;
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: GOOD_USER, password: GOOD_PASS },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('AUTH_PROVIDER_UNAVAILABLE');
    } finally {
      dashboard.down = false;
    }
  });
});
