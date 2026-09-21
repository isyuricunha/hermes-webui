import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { Composer } from './Composer';

vi.mock('../../lib/api', () => ({
  fetchCommands: vi.fn(async () => ({ commands: SAMPLE_COMMANDS })),
}));

const SAMPLE_COMMANDS: NormalizedCommand[] = [
  {
    name: '/model',
    description: 'Show or switch the active model',
    category: 'Configuration',
    aliases: [],
    argsHint: null,
    availability: 'native',
    executionMode: 'webui-native',
    handler: 'model-picker',
  },
  {
    name: '/new',
    description: 'Start a new session',
    category: 'Session',
    aliases: [],
    argsHint: '[name]',
    availability: 'native',
    executionMode: 'webui-native',
    handler: 'new-chat',
  },
  {
    name: '/compact',
    description: 'Compress the conversation context',
    category: 'Session',
    aliases: [],
    argsHint: null,
    availability: 'unsupported',
    executionMode: 'disabled',
    disabledReason: 'CLI/TUI command',
  },
];

function renderComposer(onSend = vi.fn(), onCommand = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Composer running={false} onSend={onSend} onCommand={onCommand} onStop={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onSend, onCommand, ...utils };
}

describe('Composer slash menu', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('typing / opens the command menu', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByLabelText('Message input');
    await user.type(input, '/');
    expect(await screen.findByRole('listbox', { name: 'Hermes commands' })).toBeInTheDocument();
  });

  it('filters commands by prefix (/mod finds /model)', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByLabelText('Message input');
    await user.type(input, '/mod');
    const listbox = await screen.findByRole('listbox', { name: 'Hermes commands' });
    expect(listbox.textContent).toContain('/model');
    expect(listbox.textContent).not.toContain('/new');
  });

  it('Escape closes the menu without sending', async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer();
    const input = screen.getByLabelText('Message input');
    await user.type(input, '/');
    await screen.findByRole('listbox', { name: 'Hermes commands' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Hermes commands' })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('selecting /model invokes onCommand, never onSend', async () => {
    const user = userEvent.setup();
    const { onSend, onCommand } = renderComposer();
    const input = screen.getByLabelText('Message input');
    await user.type(input, '/model');
    const option = await screen.findByRole('option', { name: /\/model/ });
    await user.click(option);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: '/model', handler: 'model-picker' }),
      '',
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keyboard navigation selects with Enter', async () => {
    const user = userEvent.setup();
    const { onCommand } = renderComposer();
    const input = screen.getByLabelText('Message input');
    await user.type(input, '/new monday plan');
    await screen.findByRole('listbox', { name: 'Hermes commands' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: '/new' }),
      'monday plan',
    );
  });
});
