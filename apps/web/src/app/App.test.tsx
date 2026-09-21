import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

/**
 * jsdom fetch mock parametrizado: auth state respondendo (o app protegido
 * renderiza) e os demais endpoints conforme o cenário do teste.
 */
function mockBackend(overrides: Record<string, { status: number; body: unknown }> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      for (const [fragment, override] of Object.entries(overrides)) {
        if (url.includes(fragment)) {
          return new Response(JSON.stringify(override.body), { status: override.status });
        }
      }
      if (url.includes('/api/auth/state')) {
        return new Response(
          JSON.stringify({
            claimed: true,
            authenticated: true,
            user: { id: 'u1', username: 'test', displayName: null, role: 'owner' },
          }),
          { status: 200 },
        );
      }
      return new Response('nope', { status: 500 });
    }),
  );
}

function renderApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens into chat with a new-chat state and an offline status pill when Hermes is offline', async () => {
    mockBackend({
      '/api/app/status': {
        status: 200,
        body: {
          app: 'hermes-webui',
          version: '0.0.0-test',
          hermes: { state: 'offline', baseUrl: 'http://127.0.0.1:8642' },
        },
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Hermes: Offline')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /New chat/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Theme:/i })).toBeInTheDocument();
  });
});
