import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { HermesClient } from '../src/hermes/client';
import type { HermesHttpError } from '../src/hermes/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gatewayStubs(handler: (url: URL) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => handler(new URL(String(input)))),
  );
}

describe('app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes /healthz and /api/healthz with the minimal public payload', async () => {
    const app = await buildApp({ disableAuth: true, config: loadConfig({}) });
    for (const url of ['/healthz', '/api/healthz']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, service: 'hermes-webui' });
    }
  });

  it('reports hermes connected when health and capabilities answer', async () => {
    gatewayStubs((url) => {
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok', platform: 'hermes-agent', version: '0.21.3' });
      }
      if (url.pathname === '/v1/capabilities') {
        return jsonResponse({ session_resources: true });
      }
      throw new TypeError('unexpected ' + url.pathname);
    });

    const app = await buildApp({
      disableAuth: true,
      config: loadConfig({
        HERMES_API_KEY: 'test-key',
        HERMES_BASE_URL: 'http://127.0.0.1:59999',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.app).toBe('hermes-webui');
    expect(body.hermes.state).toBe('connected');
    expect(body.hermes.version).toBe('0.21.3');
  });

  it('reports degraded when the gateway rejects our key', async () => {
    gatewayStubs((url) => {
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok', platform: 'hermes-agent', version: '0.21.3' });
      }
      if (url.pathname === '/v1/capabilities') {
        return jsonResponse({ error: { message: 'Invalid gateway API key (API_SERVER_KEY)' } }, 401);
      }
      throw new TypeError('unexpected ' + url.pathname);
    });

    const app = await buildApp({
      disableAuth: true,
      config: loadConfig({
        HERMES_API_KEY: 'wrong',
        HERMES_BASE_URL: 'http://127.0.0.1:59999',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    const body = response.json();
    expect(body.hermes.state).toBe('degraded');
    expect(body.hermes.reason).toBe('auth_failed');
  });

  it('reports offline when the gateway does not answer', async () => {
    gatewayStubs(() => {
      throw new TypeError('connection refused');
    });

    const app = await buildApp({
      disableAuth: true,
      config: loadConfig({ HERMES_BASE_URL: 'http://127.0.0.1:59999' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hermes.state).toBe('offline');
    expect(body.hermes.error).toContain('Could not reach Hermes gateway');
  });

  it('returns structured 404 for unknown API routes, and the SPA for non-API GETs', async () => {
    // The SPA fallback only exists when the web app has been built; pin the
    // dist dir explicitly so the test does not depend on build order.
    const distDir = mkdtempSync(path.join(tmpdir(), 'hwui-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Hermes WebUI</title>');
    const app = await buildApp({ disableAuth: true, config: { ...loadConfig({}), webDistDir: distDir } });

    const api = await app.inject({ method: 'GET', url: '/api/definitely/not/here' });
    expect(api.statusCode).toBe(404);
    const body = api.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toBeTruthy();

    // Non-API GETs fall back to the SPA shell (PRD 42.5).
    const spa = await app.inject({ method: 'GET', url: '/some/spa/route' });
    expect(spa.statusCode).toBe(200);
    expect(spa.headers['content-type']).toContain('text/html');

    // The root serves the SPA index, never a directory listing or 403.
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
  });

  it('returns structured 404 for every route when no web build is present', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'hwui-nodist-'));
    const app = await buildApp({
      disableAuth: true,
      config: { ...loadConfig({}), webDistDir: path.join(emptyDir, 'missing') },
    });
    const response = await app.inject({ method: 'GET', url: '/some/spa/route' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('gateway client maps transport failure to HERMES_UNREACHABLE', async () => {
    const neverFetch = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = new HermesClient('http://127.0.0.1:59999', 'key', {
      fetchImpl: neverFetch as unknown as typeof fetch,
      timeoutMs: 20,
    });
    await expect(client.health()).rejects.toMatchObject({
      code: 'HERMES_UNREACHABLE',
      status: 503,
    } satisfies Partial<HermesHttpError>);
    expect(neverFetch).toHaveBeenCalled();
  });
});
