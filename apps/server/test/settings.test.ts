import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

type FetchCall = { url: URL; init?: RequestInit };

const calls: FetchCall[] = [];
let handler: (url: URL, init?: RequestInit) => Response | Promise<Response> = () =>
  new Response('{}', { status: 404 });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('dashboard settings routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        return handler(url, init);
      }),
    );
    app = await buildApp(
      { config: loadConfig({ HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token' }) },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies raw config reads with the dashboard session token', async () => {
    handler = (url) => {
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.port).toBe('49173');
      expect(url.pathname).toBe('/api/config/raw');
      return json({ yaml: 'model:\n  default: model-large\n', path: '/home/u/.hermes/config.yaml' });
    };

    const response = await app.inject({ method: 'GET', url: '/api/settings/config/raw' });
    expect(response.statusCode).toBe(200);
    expect(response.json().yaml).toContain('model-large');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-hermes-session-token']).toBe('dash-token');
  });

  it('forwards raw config writes with the yaml payload', async () => {
    handler = (url, init) => {
      expect(url.pathname).toBe('/api/config/raw');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body)).yaml_text).toContain('model:');
      return json({ ok: true });
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/config/raw',
      payload: { yaml_text: 'model:\n  default: model-large\n' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('rejects raw config writes without yaml_text before touching the dashboard', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/config/raw',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(calls.length).toBe(0);
  });

  it('proxies env listing and masked values', async () => {
    handler = (url) => {
      expect(url.pathname).toBe('/api/env');
      return json({
        EXAMPLE_API_KEY: { is_set: true, redacted_value: 'sk-...***', is_password: true },
      });
    };

    const response = await app.inject({ method: 'GET', url: '/api/settings/env' });
    expect(response.statusCode).toBe(200);
    expect(response.json().EXAMPLE_API_KEY.is_set).toBe(true);
  });

  it('forwards env writes with key and value', async () => {
    handler = (url, init) => {
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body))).toEqual({ key: 'EXAMPLE_API_KEY', value: 'sk-test' });
      return json({ ok: true });
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/env',
      payload: { key: 'EXAMPLE_API_KEY', value: 'sk-test' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('maps dashboard 401 to HERMES_DASHBOARD_AUTH (502) with a human message', async () => {
    handler = () => json({ error: 'unauthenticated', reason: 'no_cookie', login_url: '/login' }, 401);

    const response = await app.inject({ method: 'GET', url: '/api/settings/schema' });
    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error.code).toBe('HERMES_DASHBOARD_AUTH');
    expect(body.error.message).toContain('HERMES_DASHBOARD_SESSION_TOKEN');
  });

  it('maps an unreachable dashboard to HERMES_DASHBOARD_UNREACHABLE (503)', async () => {
    handler = () => {
      throw new TypeError('connect ECONNREFUSED');
    };

    const response = await app.inject({ method: 'GET', url: '/api/settings/mcp/servers' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('HERMES_DASHBOARD_UNREACHABLE');
  });
});
