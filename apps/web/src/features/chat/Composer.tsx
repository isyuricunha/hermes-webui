import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { fetchCommands } from '../../lib/api';

export interface ComposerProps {
  running: boolean;
  /** When set, the composer submits a steer instead of a new message. */
  onSend: (text: string) => void;
  /** Invoked for any recognized Hermes command (never sent to the LLM). */
  onCommand?: (command: NormalizedCommand, argsText: string) => void;
  /** Opens the native model picker (also reachable via /model). */
  onOpenModelPicker?: () => void;
  /** Short real model id shown on the picker chip (UI-side metadata). */
  modelLabel?: string;
  onStop: () => void;
  /** Draft persistence key; drafts survive chat switches (PRD 16.4). */
  draftKey?: string;
  placeholder?: string;
}

function storageKeyFor(draftKey: string | undefined): string | null {
  return draftKey ? `hermes-webui-draft:${draftKey}` : null;
}

function readDraft(draftKey: string | undefined): string {
  const key = storageKeyFor(draftKey);
  if (key === null) {
    return '';
  }
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function persistDraft(draftKey: string | undefined, value: string): void {
  const key = storageKeyFor(draftKey);
  if (key === null) {
    return;
  }
  try {
    if (value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // best-effort draft persistence
  }
}

interface SlashMatch {
  query: string;
  hits: NormalizedCommand[];
}

/** Filters the catalog for the current "/query" prefix. */
function matchCommands(commands: NormalizedCommand[], value: string): SlashMatch | null {
  if (!value.startsWith('/') || value.length < 1) return null;
  const token = value.slice(1).split(/\s+/)[0] ?? '';
  const query = token.toLowerCase();
  const hits = commands
    .filter((cmd) => {
      const name = cmd.name.slice(1).toLowerCase();
      if (query === '' || name.startsWith(query)) return true;
      return (
        cmd.aliases.some((alias) => alias.toLowerCase().startsWith(query)) ||
        cmd.description.toLowerCase().includes(query)
      );
    })
    .slice(0, 12);
  return { query, hits };
}

function categoryLabel(cmd: NormalizedCommand): string {
  return cmd.availability === 'native' ? 'WebUI' : cmd.category;
}

/**
 * Composer (PRD 16): compact input, Enter sends / Shift+Enter newline, the
 * primary button becomes Stop while a run is active. Typing "/" opens the
 * Hermes command palette (desktop popover / mobile sheet): ↑↓ navigate,
 * Enter selects, Escape closes. Recognized commands go to onCommand — they
 * are never sent to the LLM. Drafts persist per session (WebUI-owned).
 */
export function Composer({
  running,
  onSend,
  onCommand,
  onOpenModelPicker,
  modelLabel,
  onStop,
  draftKey,
  placeholder,
}: ComposerProps) {
  const [value, setValue] = useState(() => readDraft(draftKey));
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const commandsQuery = useQuery({
    queryKey: ['commands'],
    queryFn: fetchCommands,
    staleTime: 10 * 60_000,
  });
  const commands = commandsQuery.data?.commands ?? [];
  const match = useMemo(
    () => (onCommand === undefined ? null : matchCommands(commands, value)),
    [commands, value, onCommand],
  );
  const menuVisible = menuOpen && match !== null && match.hits.length > 0;
  const hits = menuVisible ? match.hits : [];
  const activeIndex = Math.min(highlight, Math.max(0, hits.length - 1));

  const update = (next: string) => {
    setValue(next);
    persistDraft(draftKey, next);
    setMenuOpen(next.startsWith('/'));
    setHighlight(0);
  };

  const submit = () => {
    const text = value.trim();
    if (text === '' || running) {
      return;
    }
    onSend(text);
    update('');
    setMenuOpen(false);
  };

  const selectCommand = (cmd: NormalizedCommand) => {
    const argsText = value.trim().split(/\s+/).slice(1).join(' ');
    update('');
    setMenuOpen(false);
    if (onCommand !== undefined) {
      onCommand(cmd, argsText);
      return;
    }
    // No handler wired: keep the legacy behavior rather than dropping input.
    onSend(`${cmd.name}${argsText !== '' ? ` ${argsText}` : ''}`);
  };

  return (
    <div className="relative border-t border-border-subtle bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {menuVisible ? (
        <div
          role="listbox"
          aria-label="Hermes commands"
          className="absolute bottom-full left-2 right-2 z-30 mb-1 max-h-72 overflow-y-auto rounded-xl border border-border-subtle bg-surface-elevated shadow-lg md:left-3 md:right-auto md:w-[26rem]"
        >
          {hits.map((cmd, index) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => selectCommand(cmd)}
              className={[
                'flex min-h-[44px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                index === activeIndex ? 'bg-surface' : '',
              ].join(' ')}
            >
              <span className="flex w-full items-center gap-2">
                <span className="font-mono text-xs font-medium text-text-primary">{cmd.name}</span>
                <span
                  className={[
                    'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
                    cmd.availability === 'native'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-surface text-text-secondary',
                  ].join(' ')}
                >
                  {categoryLabel(cmd)}
                </span>
              </span>
              <span className="line-clamp-1 text-[11px] text-text-secondary">{cmd.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {onOpenModelPicker !== undefined ? (
          <button
            type="button"
            onClick={onOpenModelPicker}
            aria-label="Change model"
            title={`Change model${modelLabel !== undefined ? ` (current: ${modelLabel})` : ''}`}
            className="h-10 max-w-28 shrink-0 truncate rounded-xl border border-border-subtle px-2.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            ✦ {modelLabel ?? 'Model'} ▾
          </button>
        ) : null}
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (menuVisible) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight((index) => (index + 1) % hits.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight((index) => (index - 1 + hits.length) % hits.length);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const selected = hits[activeIndex];
                if (selected !== undefined) {
                  selectCommand(selected);
                }
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={placeholder ?? 'Message Hermes… ("/" for commands)'}
          aria-label="Message input"
          className="min-w-0 max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border-subtle bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop run"
            className="h-10 shrink-0 rounded-xl border border-danger px-4 text-sm font-medium text-danger hover:bg-surface-elevated"
          >
            ■ Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={value.trim() === ''}
            aria-label="Send message"
            className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
