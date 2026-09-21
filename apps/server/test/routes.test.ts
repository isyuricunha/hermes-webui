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

describe('gateway proxy routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    calls.length = 0;
    // The client binds fetch when buildApp constructs it, so the stub must be
    // installed BEFORE the app is built.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        return handler(url, init);
      }),
    );
    app = await buildApp({
      disableAuth: true,
      config: loadConfig({ HERMES_API_KEY: 'test-key', HERMES_BASE_URL: 'http://gateway.test' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies the session list with the bearer key', async () => {
    handler = (url) => {
      expect(url.pathname).toBe('/api/sessions');
      expect(url.searchParams.get('limit')).toBe('5');
      return json({ object: 'list', data: [{ id: 's1' }] });
    };

    const response = await app.inject({ method: 'GET', url: '/api/sessions?limit=5' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ object: 'list', data: [{ id: 's1' }] });
    const auth = calls[0]?.init?.headers as Record<string, string>;
    expect(auth.authorization).toBe('Bearer test-key');
  });

  it('creates runs with an Idempotency-Key and forwards the payload', async () => {
    handler = (url) => {
      expect(url.pathname).toBe('/v1/runs');
      return json({ run_id: 'run-1', status: 'queued' }, 201);
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { input: 'hello hermes', session_id: 's1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ run_id: 'run-1', status: 'queued' });

    const init = calls[0]?.init;
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(String(init?.body))).toEqual({ input: 'hello hermes', session_id: 's1' });
  });

  it('rejects run payloads without input', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/runs', payload: {} });
    expect(response.statusCode).toBe(400);
    expect(calls.length).toBe(0);
  });

  it('proxies stop and approval', async () => {
    handler = (url, init) => {
      if (url.pathname === '/v1/runs/r1/stop' && init?.method === 'POST') {
        return json({ run_id: 'r1', status: 'stopping' });
      }
      if (url.pathname === '/v1/runs/r1/approval' && init?.method === 'POST') {
        return json({ object: 'hermes.run.approval_response', resolved: 1 });
      }
      return json({ error: { message: 'not found' } }, 404);
    };

    const stop = await app.inject({ method: 'POST', url: '/api/runs/r1/stop' });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toEqual({ run_id: 'r1', status: 'stopping' });

    const approval = await app.inject({
      method: 'POST',
      url: '/api/runs/r1/approval',
      payload: { choice: 'once' },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json().resolved).toBe(1);
  });

  it('streams run events through as SSE', async () => {
    // Real gateway frames: data-only JSON with the event name inside .event
    // (api_server_runs.py `_sse_frame`), verified against v0.21.3.
    const sseBody =
      'data: {"event":"message.delta","run_id":"r1","delta":"hel"}\n\n' +
      'data: {"event":"run.completed","run_id":"r1","output":"done"}\n\n';
    handler = (url) => {
      expect(url.pathname).toBe('/v1/runs/r1/events');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    };

    const response = await app.inject({ method: 'GET', url: '/api/runs/r1/events' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"event":"message.delta"');
    expect(response.body).toContain('run.completed');
  });

  it('maps a gateway 401 to HERMES_AUTH_FAILED (502), not a bare error', async () => {
    handler = () => json({ error: { message: 'Invalid gateway API key' } }, 401);

    const response = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error.code).toBe('HERMES_AUTH_FAILED');
    expect(body.requestId).toBeTruthy();
  });

  it('maps an unreachable gateway to HERMES_UNREACHABLE (503)', async () => {
    handler = () => {
      throw new TypeError('connect ECONNREFUSED');
    };

    const response = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('HERMES_UNREACHABLE');
  });
});
