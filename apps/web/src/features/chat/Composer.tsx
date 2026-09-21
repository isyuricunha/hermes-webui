import { useState } from 'react';

export interface ComposerProps {
  running: boolean;
  /** When set, the composer submits a steer instead of a new message. */
  onSend: (text: string) => void;
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

/**
 * Composer (PRD 16): compact input, Enter sends / Shift+Enter newline, the
 * primary button becomes Stop while a run is active. Drafts persist per
 * session in localStorage (WebUI-owned presentation state). The parent must
 * key this component by session so a chat switch starts a fresh draft.
 */
export function Composer({ running, onSend, onStop, draftKey, placeholder }: ComposerProps) {
  const [value, setValue] = useState(() => readDraft(draftKey));

  const update = (next: string) => {
    setValue(next);
    persistDraft(draftKey, next);
  };

  const submit = () => {
    const text = value.trim();
    if (text === '' || running) {
      return;
    }
    onSend(text);
    update('');
  };

  return (
    <div className="flex items-end gap-2 border-t border-border-subtle bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <textarea
        value={value}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={placeholder ?? 'Message Hermes…'}
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
  );
}
