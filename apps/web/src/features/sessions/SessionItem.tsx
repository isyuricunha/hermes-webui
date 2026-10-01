import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  Clock,
  GitFork,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Send,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { Menu } from '../../components/ui';

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  cron: 'Cron',
  cli: 'CLI',
  tui: 'Terminal',
};

export function SourceIcon({ source }: { source: string | null }) {
  const key = (source ?? '').toLowerCase();
  const label = SOURCE_LABELS[key] ?? 'WebUI';
  const className = 'size-3.5';
  return (
    <span title={label} className="flex shrink-0 text-text-tertiary">
      {key === 'telegram' ? (
        <Send className={className} aria-hidden />
      ) : key === 'cron' ? (
        <Clock className={className} aria-hidden />
      ) : key === 'cli' || key === 'tui' ? (
        <SquareTerminal className={className} aria-hidden />
      ) : (
        <MessageSquare className={className} aria-hidden />
      )}
      <span className="sr-only">{`(${label})`}</span>
    </span>
  );
}

export interface SessionItemActions {
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onFork: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** One conversation row: link, inline rename, and a "…" actions menu. */
export function SessionItem({
  id,
  name,
  source,
  pinned,
  onNavigate,
  actions,
}: {
  id: string;
  name: string;
  source: string | null;
  pinned: boolean;
  onNavigate?: () => void;
  actions: SessionItemActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    const commit = () => {
      const next = draft.trim();
      setEditing(false);
      if (next !== '' && next !== name) actions.onRename(next);
    };
    return (
      <li className="px-0.5 py-0.5">
        <input
          ref={inputRef}
          value={draft}
          aria-label={`New title for ${name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="yu-input h-9 w-full px-2.5 text-[13.5px]"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        to="/chat/$sessionId"
        params={{ sessionId: id }}
        onClick={onNavigate}
        onDoubleClick={(event) => {
          event.preventDefault();
          setDraft(name);
          setEditing(true);
        }}
        className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-text-secondary transition-colors hover:bg-surface-input hover:text-text-primary"
        activeProps={{ className: 'bg-chip !text-text-primary' }}
        title={`${name} (${id})`}
      >
        <SourceIcon source={source} />
        <span className="min-w-0 flex-1 truncate group-hover:pr-7 group-focus-within:pr-7">{name}</span>
        {pinned ? <Pin className="size-3 shrink-0 text-accent group-hover:hidden [@media(hover:none)]:hidden" aria-label="Pinned" /> : null}
      </Link>
      <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 group-hover:block group-focus-within:block [@media(hover:none)]:block">
        <Menu
          label={`Actions for ${name}`}
          trigger={<MoreHorizontal className="size-4" aria-hidden />}
          items={[
            {
              label: 'Rename',
              icon: <Pencil />,
              onSelect: () => {
                setDraft(name);
                setEditing(true);
              },
            },
            pinned
              ? { label: 'Unpin', icon: <PinOff />, onSelect: actions.onTogglePin }
              : { label: 'Pin', icon: <Pin />, onSelect: actions.onTogglePin },
            { label: 'Fork', icon: <GitFork />, onSelect: actions.onFork },
            { label: 'Archive', icon: <Archive />, onSelect: actions.onArchive },
            { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: actions.onDelete },
          ]}
        />
      </span>
    </li>
  );
}
