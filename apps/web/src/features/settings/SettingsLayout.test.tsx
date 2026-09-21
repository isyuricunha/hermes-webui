import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppRouter } from '../../app/router';

/**
 * Mobile shell tests (PRD 55): the Settings navigation must live behind a
 * hamburger on narrow viewports, open as a drawer, and close on selection.
 * The hide/show itself is CSS (off-canvas transform); these tests pin the
 * interactive contract (open/close/navigation) and the real route tree.
 */

function renderSettingsAt(path = '/settings/models'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('SettingsLayout mobile shell', () => {
  afterEach(() => {
    cleanup();
  });

  it('starts with the drawer closed behind the hamburger', async () => {
    renderSettingsAt('/settings/models');
    const hamburger = await screen.findByRole('button', {
      name: 'Open Settings navigation',
    });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the drawer with search and all sections', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/models');
    const hamburger = await screen.findByRole('button', {
      name: 'Open Settings navigation',
    });
    await user.click(hamburger);

    expect(screen.getByRole('button', { name: 'Open Settings navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('Search settings')).toBeInTheDocument();
    for (const label of [
      'Models',
      'MCP',
      'Skills',
      'Cron',
      'Messaging',
      'System',
      'Raw Config',
      'Environment',
      'Hermes CLI',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('closes the drawer after selecting a section and shows the page', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/models');
    const hamburger = await screen.findByRole('button', {
      name: 'Open Settings navigation',
    });
    await user.click(hamburger);
    await user.click(screen.getByRole('link', { name: 'Models' }));

    expect(screen.getByRole('button', { name: 'Open Settings navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Models page heading rendered from the real route tree (data fetches
    // fail in jsdom without a backend — that's covered by route tests).
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
  });

  it('closes the drawer with Escape', async () => {
    const user = userEvent.setup();
    renderSettingsAt('/settings/models');
    const hamburger = await screen.findByRole('button', {
      name: 'Open Settings navigation',
    });
    await user.click(hamburger);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open Settings navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
