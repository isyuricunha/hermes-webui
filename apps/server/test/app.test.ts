import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { HermesClient } from '../src/hermes/client';

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

describe('app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes /api/healthz', async () => {
    const app = await buildApp({ config: loadConfig({}) });
    const response = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('reports hermes connected when a probe answers', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/')) return okResponse('gateway root');
      throw new TypeError('refused');
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp({
      config: loadConfig({ HERMES_BASE_URL: 'http://127.0.0.1:59999' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.app).toBe('hermes-webui');
    expect(body.hermes.state).toBe('connected');
    expect(body.hermes.probe).toBe('/');
  });

  it('reports hermes offline when nothing answers', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp({
      config: loadConfig({ HERMES_BASE_URL: 'http://127.0.0.1:59999' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hermes.state).toBe('offline');
    expect(body.hermes.error).toContain('no probe answered');
  });

  it('returns a structured 404, never a bare error', async () => {
    const app = await buildApp({ config: loadConfig({}) });
    const response = await app.inject({ method: 'GET', url: '/definitely/not/here' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toBeTruthy();
  });

  it('hermes client honors timeout option', async () => {
    const neverFetch = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = new HermesClient('http://127.0.0.1:59999', {
      fetchImpl: neverFetch as unknown as typeof fetch,
      timeoutMs: 20,
    });
    const probe = await client.checkReachable();
    expect(probe.reachable).toBe(false);
    expect(neverFetch).toHaveBeenCalled();
  });
});
