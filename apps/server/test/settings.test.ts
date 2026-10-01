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
      { disableAuth: true, config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local', HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token' }) },
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

  it('lets the live gateway channel state win over the dashboard guess', async () => {
    handler = (url) => {
      if (url.pathname === '/api/messaging/platforms') {
        return json({
          platforms: [
            { id: 'telegram', enabled: true, configured: true, state: 'pending_restart', gateway_running: true },
            { id: 'discord', enabled: false, configured: false, state: 'disabled', gateway_running: true },
            { id: 'slack', enabled: true, configured: true, state: 'pending_restart', gateway_running: true },
          ],
        });
      }
      if (url.pathname === '/health/detailed') {
        return json({
          gateway: {
            platforms: {
              telegram: { state: 'connected', error_code: null },
              discord: { state: 'connected' },
            },
          },
        });
      }
      return json({}, 404);
    };

    const response = await app.inject({ method: 'GET', url: '/api/settings/messaging/platforms' });
    expect(response.statusCode).toBe(200);
    const states = Object.fromEntries(
      (response.json().platforms as { id: string; state: string }[]).map((p) => [p.id, p.state]),
    );
    expect(states).toEqual({ telegram: 'connected', discord: 'disabled', slack: 'pending_restart' });
  });

  it('still lists channels when the gateway health check fails', async () => {
    handler = (url) =>
      url.pathname === '/api/messaging/platforms'
        ? json({ platforms: [{ id: 'telegram', enabled: true, configured: true, state: 'pending_restart' }] })
        : json({ error: 'down' }, 500);
    const response = await app.inject({ method: 'GET', url: '/api/settings/messaging/platforms' });
    expect(response.statusCode).toBe(200);
    expect(response.json().platforms[0].state).toBe('pending_restart');
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

  it('forwards gateway restart and update apply with the token', async () => {
    handler = (url, init) => {
      if (url.pathname === '/api/gateway/restart') {
        expect(init?.method).toBe('POST');
        return json({ pid: 1234 });
      }
      if (url.pathname === '/api/hermes/update') {
        expect(init?.method).toBe('POST');
        return json({ ok: true });
      }
      return json({ error: { message: 'not found' } }, 404);
    };

    const restart = await app.inject({ method: 'POST', url: '/api/settings/gateway/restart' });
    expect(restart.statusCode).toBe(200);
    expect(restart.json()).toEqual({ pid: 1234 });
    const restartHeaders = calls[0]?.init?.headers as Record<string, string>;
    expect(restartHeaders['x-hermes-session-token']).toBe('dash-token');

    const update = await (async () => {
      // Update apply is deny-by-default (custom-patched install); opt in for
      // the passthrough assertion here; the next test pins the default 403.
      process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY = '1';
      const response = await app.inject({ method: 'POST', url: '/api/settings/update/apply' });
      delete process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY;
      return response;
    })();
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ ok: true });
  });

  it('refuses update apply by default (custom-patched install) unless explicitly enabled', async () => {
    delete process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY;
    const denied = await app.inject({ method: 'POST', url: '/api/settings/update/apply' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('UPDATE_APPLY_DISABLED');
    expect(calls.length).toBe(0);

    // Opt-in flag turns the passthrough back on.
    process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY = '1';
    handler = (url, init) => {
      expect(url.pathname).toBe('/api/hermes/update');
      expect(init?.method).toBe('POST');
      return json({ ok: true });
    };
    const allowed = await app.inject({ method: 'POST', url: '/api/settings/update/apply' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ ok: true });
    delete process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY;
  });

  it('serves logs only from the allowlist and caps the line count', async () => {
    handler = (url) => {
      expect(url.pathname).toBe('/api/logs');
      expect(url.searchParams.get('file')).toBe('gateway');
      expect(url.searchParams.get('lines')).toBe('42');
      return json({ file: 'gateway', lines: ['line1'] });
    };

    const ok = await app.inject({
      method: 'GET',
      url: '/api/settings/logs?file=gateway&lines=42',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().file).toBe('gateway');

    // Arbitrary file names must never reach the dashboard: the allowlist
    // collapses them to the default, and only 'agent' may hit the upstream.
    handler = (url) => {
      expect(url.searchParams.get('file')).toBe('agent');
      return json({ file: 'agent', lines: [] });
    };
    const denied = await app.inject({
      method: 'GET',
      url: '/api/settings/logs?file=../../etc/passwd',
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().file).toBe('agent');
  });
});
