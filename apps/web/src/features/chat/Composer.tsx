import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, FileText, Film, LoaderCircle, Mic, Music, Paperclip, Sparkles, Square, X } from 'lucide-react';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { fetchCommands } from '../../lib/api';
import { toast } from '../../lib/toast';
import { bytes } from '../../lib/format';
import { MAX_ATTACHMENTS, readAttachment, type PendingAttachment } from './attachments';
import { useVoiceInput } from './useVoiceInput';
import { COMPOSER_INSERT_EVENT } from './composerBus';
import { FOCUS_COMPOSER_EVENT } from '../../lib/events';

export interface ComposerProps {
  running: boolean;
  /** Sends a new message (text plus any attachments). */
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  /** Invoked for any recognized Hermes command (never sent to the LLM). */
  onCommand?: (command: NormalizedCommand, argsText: string) => void;
  /** Opens the native model picker (also reachable via /model). */
  onOpenModelPicker?: () => void;
  /** Short real model id shown on the picker chip (UI-side metadata). */
  modelLabel?: string;
  /** Explains the model chip on hover (where the model comes from). */
  modelHint?: string;
  /** More controls in the toolbar, after the model chip (reasoning, context). */
  extras?: ReactNode;
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
  // Rank so Enter on a fully typed name runs that command: exact name, then
  // name prefix, alias prefix (e.g. /journey's "memory-graph"), description.
  const rank = (cmd: NormalizedCommand): number => {
    const name = cmd.name.slice(1).toLowerCase();
    if (query === '' || name === query) return 0;
    if (name.startsWith(query)) return 1;
    if (cmd.aliases.some((alias) => alias.toLowerCase().startsWith(query))) return 2;
    return cmd.description.toLowerCase().includes(query) ? 3 : 4;
  };
  const hits = commands
    .map((cmd, index) => ({ cmd, index, rank: rank(cmd) }))
    .filter((hit) => hit.rank < 4)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((hit) => hit.cmd)
    .slice(0, 12);
  return { query, hits };
}

function categoryLabel(cmd: NormalizedCommand): string {
  if (cmd.availability === 'native') return 'WebUI';
  if (cmd.availability === 'unsupported') return 'Terminal only';
  return cmd.category;
}

function categoryTip(cmd: NormalizedCommand): string {
  if (cmd.availability === 'native') return 'Runs right here in the WebUI.';
  if (cmd.availability === 'unsupported') return cmd.disabledReason ?? 'Only makes sense in the terminal app.';
  return 'Runs inside Hermes; you see the same output as in the terminal.';
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
  modelHint,
  extras,
  onStop,
  onSteer,
  draftKey,
  placeholder,
}: ComposerProps) {
  const [value, setValue] = useState(() => readDraft(draftKey));
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      setUploading((count) => count + 1);
      try {
        const attachment = await readAttachment(file);
        setAttachments((current) => {
          if (current.length >= MAX_ATTACHMENTS) {
            toast(`Up to ${MAX_ATTACHMENTS} attachments per message.`, 'error');
            return current;
          }
          return [...current, attachment];
        });
      } catch (error) {
        toast(error instanceof Error ? `${file.name}: ${error.message}` : 'Could not attach that file.', 'error');
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }, []);

  const appendText = useCallback((text: string) => {
    setValue((current) => {
      const next = current.trim() === '' ? text : `${current.replace(/\s+$/, '')} ${text}`;
      persistDraft(draftKey, next);
      return next;
    });
    inputRef.current?.focus();
  }, [draftKey]);

  const voice = useVoiceInput(appendText, (message) => toast(message, 'error'));

  useEffect(() => {
    const onInsert = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== 'string') return;
      setValue(text);
      persistDraft(draftKey, text);
      requestAnimationFrame(() => {
        const node = inputRef.current;
        node?.focus();
        node?.setSelectionRange(text.length, text.length);
      });
    };
    const onFocus = () => inputRef.current?.focus();
    const onAttach = () => fileRef.current?.click();
    window.addEventListener(COMPOSER_INSERT_EVENT, onInsert);
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocus);
    window.addEventListener('hermes-webui:composer-attach', onAttach);
    return () => {
      window.removeEventListener(COMPOSER_INSERT_EVENT, onInsert);
      window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocus);
      window.removeEventListener('hermes-webui:composer-attach', onAttach);
    };
  }, [draftKey]);

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
    if (steering) {
      if (text === '') return;
      onSteer(text);
    } else if (running) {
      return;
    } else {
      if (text === '' && attachments.length === 0) return;
      if (uploading > 0) {
        toast('Still uploading an attachment…', 'info');
        return;
      }
      onSend(text, attachments);
      setAttachments([]);
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
    onSend(`${cmd.name}${argsText !== '' ? ` ${argsText}` : ''}`, []);
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
                  data-tip={categoryTip(cmd)}
                  className={[
                    'yu-chip shrink-0 px-1.5 py-0 text-[10px]',
                    cmd.availability === 'native'
                      ? 'yu-chip-accent'
                      : cmd.availability === 'unsupported'
                        ? 'yu-chip-neutral opacity-60'
                        : 'yu-chip-agent',
                  ].join(' ')}
                >
                  {categoryLabel(cmd)}
                </span>
              </span>
              <span className="line-clamp-1 text-[11px] text-text-tertiary">
                {cmd.argsHint !== null && cmd.argsHint !== undefined ? <span className="font-mono">{cmd.argsHint} · </span> : null}
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={[
          'yu-input relative rounded-[20px] px-2 pt-2 pb-2 transition-shadow',
          dragging ? '!border-accent' : '',
        ].join(' ')}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          setDragging(false);
          void addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[20px] bg-surface-input/90 text-sm text-accent">
            Drop to attach
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-1.5 pt-1 pb-1.5">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="group/att relative">
                {attachment.kind === 'image' ? (
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="size-16 rounded-xl border border-border-subtle object-cover"
                  />
                ) : (
                  <div
                    className="flex h-16 w-40 items-center gap-2 rounded-xl border border-border-subtle bg-chip px-2.5"
                    title={attachment.kind === 'file' ? `${attachment.name}: saved for Hermes, which reads it from the server` : `${attachment.name}: inlined into the message`}
                  >
                    {attachment.upload?.kind === 'audio' ? (
                      <Music className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                    ) : attachment.upload?.kind === 'video' ? (
                      <Film className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                    ) : (
                      <FileText className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-text-primary">{attachment.name}</span>
                      <span className="block font-mono text-[10px] text-text-tertiary">{bytes(attachment.size)}</span>
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-text-primary text-background shadow"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            ))}
            {uploading > 0 ? (
              <div className="flex h-16 items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 text-xs text-text-secondary">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                Uploading…
              </div>
            ) : null}
          </div>
        ) : uploading > 0 ? (
          <div className="flex items-center gap-2 px-2.5 pt-1 pb-1.5 text-xs text-text-secondary">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            Uploading…
          </div>
        ) : null}
        {voice.state === 'recording' ? (
          <div className="flex min-h-[2.75rem] items-center gap-3 px-2.5 py-2">
            <span className="yu-pulse size-2 rounded-full bg-danger text-danger" aria-hidden />
            <span className="yu-shimmer text-[15px]">Listening…</span>
            <span className="font-mono text-xs text-text-tertiary">
              {Math.floor(voice.elapsed / 60)}:{String(voice.elapsed % 60).padStart(2, '0')}
            </span>
          </div>
        ) : voice.state === 'transcribing' ? (
          <div className="flex min-h-[2.75rem] items-center px-2.5 py-2">
            <span className="yu-shimmer-agent text-[15px]">Transcribing…</span>
          </div>
        ) : (
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => update(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
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
        )}
        <div className="flex items-center gap-1 pt-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach files"
            title="Attach files: images, audio, video, PDFs, documents, code (also drag and drop or paste)"
            disabled={steering}
            className="yu-btn yu-btn-ghost size-8 rounded-lg"
          >
            <Paperclip className="size-4" aria-hidden />
          </button>
          {onOpenModelPicker !== undefined ? (
            <button
              type="button"
              onClick={onOpenModelPicker}
              aria-label="Change model"
              data-tip={modelHint ?? `Change model${modelLabel !== undefined ? ` (current: ${modelLabel})` : ''}`}
              data-tip-wide
              className="yu-btn yu-btn-ghost h-8 max-w-[14rem] gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="truncate font-mono">{modelLabel ?? 'Model'}</span>
              <ChevronDown className="size-3 shrink-0" aria-hidden />
            </button>
          ) : null}
          {extras}
          <span className="flex-1" />
          {voice.supported && !running ? (
            voice.state === 'recording' ? (
              <>
                <button
                  type="button"
                  onClick={voice.cancel}
                  aria-label="Cancel recording"
                  className="yu-btn yu-btn-ghost h-8 rounded-lg px-2.5 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={voice.stop}
                  aria-label="Stop recording and transcribe"
                  className="yu-btn yu-btn-danger size-9 rounded-full"
                >
                  <Square className="size-3.5 fill-current" aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void voice.start()}
                disabled={voice.state === 'transcribing'}
                aria-label="Dictate"
                title="Dictate (transcribed by Hermes)"
                className="yu-btn yu-btn-ghost size-9 rounded-full"
              >
                <Mic className="size-4" aria-hidden />
              </button>
            )
          ) : null}
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
          ) : voice.state === 'recording' ? null : (
            <button
              type="button"
              onClick={submit}
              disabled={value.trim() === '' && attachments.length === 0}
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
