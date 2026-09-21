import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * jsdom fetch mock: rotas de auth respondem autenticadas (o app protegido
 * renderiza nos testes de componentes); qualquer outra chamada de API falha
 * de forma previsível para o teste tratar. Re-aplicado a cada teste porque
 * specs individuais podem re-stubar o fetch global.
 */
const AUTH_STATE = {
  claimed: true,
  authenticated: true,
  user: { id: 'u-test', username: 'test-user', displayName: null, role: 'owner' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authAwareFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/auth/state')) {
    return Promise.resolve(jsonResponse(200, AUTH_STATE));
  }
  if (url.includes('/api/commands')) {
    return Promise.resolve(jsonResponse(200, { commands: [] }));
  }
  return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_MOCKED', message: url } }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(authAwareFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});
