import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Sparkles, Square } from 'lucide-react';
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
  /**
   * While a run is active, Enter steers it instead (gateway
   * /v1/runs/:id/steer) when provided.
   */
  onSteer?: (text: string) => void;
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
  onSteer,
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

  const steering = running && onSteer !== undefined;

  // Auto-grow the textarea up to its max height.
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (text === '') {
      return;
    }
    if (steering) {
      onSteer(text);
    } else if (running) {
      return;
    } else {
      onSend(text);
    }
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
    <div className="relative">
      {menuVisible ? (
        <div
          role="listbox"
          aria-label="Hermes commands"
          className="yu-pop absolute bottom-full left-0 right-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-2xl p-1.5 md:right-auto md:w-[26rem]"
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
                'flex min-h-[44px] w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left',
                index === activeIndex ? 'bg-chip' : '',
              ].join(' ')}
            >
              <span className="flex w-full items-center gap-2">
                <span className="font-mono text-xs font-medium text-text-primary">{cmd.name}</span>
                <span
                  className={[
                    'yu-chip shrink-0 px-1.5 py-0 text-[10px]',
                    cmd.availability === 'native' ? 'yu-chip-accent' : 'yu-chip-neutral',
                  ].join(' ')}
                >
                  {categoryLabel(cmd)}
                </span>
              </span>
              <span className="line-clamp-1 text-[11px] text-text-tertiary">{cmd.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="yu-input rounded-[20px] px-2 pt-2 pb-2 transition-shadow">
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
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            steering ? 'Steer the running task…' : (placeholder ?? 'Message Hermes… ("/" for commands)')
          }
          aria-label="Message input"
          className="block max-h-60 min-h-[2.75rem] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
        />
        <div className="flex items-center gap-2 pt-1">
          {onOpenModelPicker !== undefined ? (
            <button
              type="button"
              onClick={onOpenModelPicker}
              aria-label="Change model"
              title={`Change model${modelLabel !== undefined ? ` (current: ${modelLabel})` : ''}`}
              className="yu-btn yu-btn-ghost h-8 max-w-[14rem] gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="truncate font-mono">{modelLabel ?? 'Model'}</span>
              <ChevronDown className="size-3 shrink-0" aria-hidden />
            </button>
          ) : null}
          <span className="flex-1" />
          {steering && value.trim() !== '' ? (
            <button
              type="button"
              onClick={submit}
              aria-label="Steer"
              className="yu-btn yu-btn-tonal h-8 rounded-lg px-3 text-xs"
            >
              Steer
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop run"
              title="Stop"
              className="yu-btn yu-btn-tonal size-9 rounded-full"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={value.trim() === ''}
              aria-label="Send message"
              title="Send (Enter)"
              className="yu-btn yu-btn-primary size-9 rounded-full"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
