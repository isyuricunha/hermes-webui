import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

interface Command {
  id: string;
  label: string;
  hint?: string;
  to?: '/' | '/settings';
  run?: () => void;
}

/**
 * Command palette (PRD 39): Cmd/Ctrl+K, searches chats, settings and
 * actions. The full indexed version (chats, MCP, skills, providers) arrives
 * with the settings workspace; navigation and theming actions are real.
 */
export function CommandPalette({ onCycleTheme }: { onCycleTheme: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const openPalette = () => {
    setQuery('');
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          openPalette();
        }
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const commands: Command[] = useMemo(
    () => [
      { id: 'new-chat', label: 'New chat', to: '/' },
      { id: 'settings', label: 'Open Settings', to: '/settings' },
      {
        id: 'cycle-theme',
        label: 'Cycle theme',
        hint: 'system / light / dark',
        run: () => {
          onCycleTheme();
          setOpen(false);
        },
      },
    ],
    [onCycleTheme],
  );

  const filtered = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated shadow-xl">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command or search…"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-sm outline-none placeholder:text-text-secondary"
          aria-label="Search commands"
        />
        <ul className="max-h-72 overflow-y-auto p-1">
          {filtered.map((command) => (
            <li key={command.id}>
              {command.to ? (
                <Link
                  to={command.to}
                  onClick={() => setOpen(false)}
                  className="block cursor-pointer rounded-lg px-3 py-2 text-sm hover:bg-surface"
                >
                  {command.label}
                  {command.hint ? (
                    <span className="ml-2 text-xs text-text-secondary">{command.hint}</span>
                  ) : null}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={command.run}
                  className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  {command.label}
                  {command.hint ? (
                    <span className="ml-2 text-xs text-text-secondary">{command.hint}</span>
                  ) : null}
                </button>
              )}
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-secondary">No matching commands.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
