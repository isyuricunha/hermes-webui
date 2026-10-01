import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

type FetchCall = { url: URL; init?: RequestInit };

const calls: FetchCall[] = [];
let handler: (url: URL, init?: RequestInit) => Response | Promise<Response> = () =>
  new Response('{}', { status: 404 });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

describe('allowlisted dashboard proxy (/api/hx/*)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    stubFetch();
    app = await buildApp({
      disableAuth: true,
      config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local', HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards an allowed GET with only the allowlisted query keys', async () => {
    handler = () => json({ daily: [], totals: {} });
    const response = await app.inject({ method: 'GET', url: '/api/hx/analytics/usage?days=7&profile=evil&x=1' });
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/api/analytics/usage');
    expect(calls[0]!.url.search).toBe('?days=7');
    expect(new Headers(calls[0]!.init?.headers).get('x-hermes-session-token')).toBe('dash-token');
  });

  it('forwards JSON bodies on allowed mutations', async () => {
    handler = (_url, init) => json({ ok: true, echo: JSON.parse(String(init?.body)) });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/hx/skills/toggle',
      payload: { name: 'recency-anchor', enabled: false },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(response.json().echo).toEqual({ name: 'recency-anchor', enabled: false });
  });

  it('forwards messaging channel setup writes and guided pairings', async () => {
    handler = (_url, init) => json({ ok: true, echo: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    const save = await app.inject({
      method: 'PUT',
      url: '/api/hx/messaging/platforms/discord',
      payload: { enabled: true, env: { DISCORD_BOT_TOKEN: 'x' }, clear_env: [] },
    });
    expect(save.statusCode).toBe(200);
    expect(calls[0]!.url.pathname).toBe('/api/messaging/platforms/discord');
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(save.json().echo.enabled).toBe(true);

    for (const [method, url] of [
      ['POST', '/api/hx/messaging/platforms/discord/test'],
      ['POST', '/api/hx/messaging/telegram/onboarding/start'],
      ['GET', '/api/hx/messaging/telegram/onboarding/Ab_c-12'],
      ['POST', '/api/hx/messaging/whatsapp/onboarding/Ab_c-12/apply'],
      ['DELETE', '/api/hx/messaging/whatsapp/onboarding/Ab_c-12'],
    ] as const) {
      const response = await app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) });
      expect(response.statusCode, url).toBe(200);
    }
    expect(calls.map((call) => call.url.pathname)).toContain('/api/messaging/whatsapp/onboarding/Ab_c-12/apply');
  });

  it('never forwards routes that are not on the allowlist', async () => {
    for (const url of ['/api/hx/env/reveal', '/api/hx/audio/voice-config', '/api/hx/fs/write-text', '/api/hx/git/review/push']) {
      const response = await app.inject({ method: url.includes('write') || url.includes('push') || url.includes('reveal') ? 'POST' : 'GET', url });
      expect(response.statusCode).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects path parameters outside the safe alphabet', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/hx/profiles/..%2F..%2Fetc/soul' });
    expect([400, 404]).toContain(response.statusCode);
    expect(calls).toHaveLength(0);
  });

  it('rejects dot-only path parameters that would reach another route', async () => {
    // Either the router refuses to match (404) or the guard rejects (400):
    // what matters is that nothing reaches the dashboard.
    for (const url of ['/api/hx/cron/jobs/%2E%2E/runs', '/api/hx/profiles/%2E/soul', '/api/hx/cron/jobs/../runs']) {
      const response = await app.inject({ method: 'GET', url });
      expect([400, 404]).toContain(response.statusCode);
    }
    const put = await app.inject({ method: 'PUT', url: '/api/hx/webhooks/%2E%2E/enabled', payload: { enabled: true } });
    expect([400, 404]).toContain(put.statusCode);
    expect(calls).toHaveLength(0);
  });

  it('streams downloads with the upstream content type', async () => {
    handler = () =>
      new Response('{"id":"s1","messages":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    const response = await app.inject({ method: 'GET', url: '/api/hx/sessions/s1/export' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toBe('{"id":"s1","messages":[]}');
    expect(calls[0]!.url.pathname).toBe('/api/sessions/s1/export');
  });

  it('serves MEDIA files through the dashboard, sandboxed and briefly cacheable', async () => {
    handler = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
    const file = '/home/me/pictures/docs 1440.png';
    const response = await app.inject({ method: 'GET', url: `/api/hx/fs/download?path=${encodeURIComponent(file)}&profile=x` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-security-policy']).toContain('sandbox');
    expect(response.headers['cache-control']).toBe('private, max-age=600');
    expect(calls[0]!.url.pathname).toBe('/api/fs/download');
    expect(calls[0]!.url.searchParams.get('path')).toBe(file);
    expect(calls[0]!.url.searchParams.has('profile')).toBe(false);
  });

  it('refuses file paths outside the MEDIA policy without calling Hermes', async () => {
    handler = () => new Response('secret', { status: 200 });
    for (const file of [
      '/home/me/.ssh/id_ed25519',
      '/home/me/.ssh/look.png',
      '/home/me/.hermes/config.yaml',
      '/home/me/.env',
      'relative/a.png',
      '/home/me/../../etc/shadow.txt',
      '/etc/passwd.txt',
      '',
    ]) {
      const response = await app.inject({ method: 'GET', url: `/api/hx/fs/download?path=${encodeURIComponent(file)}` });
      expect(response.statusCode, file).toBe(400);
    }
    const missing = await app.inject({ method: 'GET', url: '/api/hx/fs/download' });
    expect(missing.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('maps upstream failures onto the error envelope', async () => {
    handler = () => json({ detail: 'Unknown skill' }, 404);
    const response = await app.inject({ method: 'GET', url: '/api/hx/skills/content?name=nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('Unknown skill');
  });

  it('accepts large audio payloads on the transcription route only', async () => {
    handler = () => json({ ok: true, transcript: 'oi' });
    const big = `data:audio/webm;base64,${'A'.repeat(3 * 1024 * 1024)}`;
    const ok = await app.inject({ method: 'POST', url: '/api/hx/audio/transcribe', payload: { data_url: big } });
    expect(ok.statusCode).toBe(200);
    const tooBig = await app.inject({ method: 'POST', url: '/api/hx/audio/speak', payload: { text: big } });
    expect(tooBig.statusCode).toBe(413);
  });
});

describe('proxy auth policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a signed-in session', async () => {
    stubFetch();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwui-proxy-'));
    const app = await buildApp({
      dataDir,
      config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local', HERMES_WEBUI_DATA_DIR: dataDir }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/hx/analytics/usage?days=7' });
    expect(response.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('run input with images', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    stubFetch();
    app = await buildApp({ disableAuth: true, config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps text + image parts as one user message for /v1/runs', async () => {
    handler = () => json({ run_id: 'run_1', status: 'running' });
    const parts = [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ];
    const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { input: parts, session_id: 's1' } });
    expect(response.statusCode).toBe(200);
    const sent = JSON.parse(String(calls[0]!.init?.body));
    expect(sent.input).toEqual([{ role: 'user', content: parts }]);
    expect(sent.session_id).toBe('s1');
  });

  it('accepts an image with no text (a one-element part list)', async () => {
    handler = () => json({ run_id: 'run_1', status: 'running' });
    const parts = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }];
    const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { input: parts } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(String(calls[0]!.init?.body)).input).toEqual([{ role: 'user', content: parts }]);
  });

  it('keeps plain text input as a string and rejects empty input', async () => {
    handler = () => json({ run_id: 'run_1', status: 'running' });
    const ok = await app.inject({ method: 'POST', url: '/api/runs', payload: { input: 'hello' } });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(String(calls[0]!.init?.body)).input).toBe('hello');
    for (const input of ['', [], ['hello'], { type: 'text', text: 'x' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { input } });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });

  it('rejects non-image data URLs and unknown part types', async () => {
    handler = () => json({ run_id: 'run_1', status: 'running' });
    for (const part of [
      { type: 'image_url', image_url: { url: 'data:text/html;base64,PGgxPg==' } },
      { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
      { type: 'input_file', file_id: 'x' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { input: [part] } });
      expect(response.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});
