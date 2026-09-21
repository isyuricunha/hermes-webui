import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';

describe('App shell', () => {
  it('opens into chat with a new-chat state and an offline status pill when the backend is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Hermes: Offline')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '+ New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Theme:/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
