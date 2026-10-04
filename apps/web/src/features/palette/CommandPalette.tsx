import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Keyboard, MessageSquare, Search, SquarePen, SunMoon } from 'lucide-react';
import { fetchSessions } from '../../lib/api';
import { derivedTitle } from '../../lib/sessionTitles';
import { SETTINGS_ITEMS } from '../../app/settingsNav';
import { relativeTime } from '../../lib/format';
import { OPEN_PALETTE_EVENT, OPEN_SHORTCUTS_EVENT } from '../../lib/events';

interface Command {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

/**
 * Command palette (PRD 39), Ctrl/Cmd+K: jump to any conversation or
 * settings page, or run an action. Arrow keys move, Enter runs.
 */
export function CommandPalette({ onCycleTheme }: { onCycleTheme: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(80),
    enabled: open,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        setActive(0);
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => {
      setQuery('');
      setActive(0);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const commands: Command[] = useMemo(() => {
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const actions: Command[] = [
      {
        id: 'new-chat',
        section: t('palette.section.actions'),
        label: t('sessions.newChat'),
        hint: 'Ctrl+Shift+O',
        icon: <SquarePen />,
        run: close(() => void navigate({ to: '/' })),
      },
      {
        id: 'theme',
        section: t('palette.section.actions'),
        label: t('palette.switchTheme'),
        hint: t('palette.themeHints'),
        icon: <SunMoon />,
        run: close(onCycleTheme),
      },
      {
        id: 'shortcuts',
        section: t('palette.section.actions'),
        label: t('common.keyboardShortcuts'),
        hint: '?',
        icon: <Keyboard />,
        run: close(() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))),
      },
    ];
    const conversations: Command[] = [...(sessions.data?.data ?? [])]
      .filter((session) => session.archived !== true)
      .sort((a, b) => (b.last_active ?? b.started_at) - (a.last_active ?? a.started_at))
      .slice(0, 40)
      .map((session) => ({
        id: `chat-${session.id}`,
        section: 'Conversations' as const,
        label: session.title?.trim() || derivedTitle(session.id) || t('sessions.newChat'),
        hint: relativeTime(session.last_active ?? session.started_at),
        icon: <MessageSquare />,
        keywords: session.source,
        run: close(
          () => void navigate({ to: '/chat/$sessionId', params: { sessionId: session.id } }),
        ),
      }));
    const settings: Command[] = SETTINGS_ITEMS.map((item) => {
      const Icon = item.icon;
      return {
        id: `settings-${item.to}`,
        section: t('settings.title'),
        label: t(item.label),
        hint: t('settings.title'),
        icon: <Icon />,
        keywords: item.keywords,
        run: close(() => void navigate({ to: item.to })),
      };
    });
    return [...actions, ...conversations, ...settings];
  }, [sessions.data, navigate, onCycleTheme]);

  const needle = query.trim().toLowerCase();
  const filtered =
    needle === ''
      ? commands.filter(
          (command) => command.section !== 'Conversations' || commands.indexOf(command) < 3 + 8,
        )
      : commands.filter((command) =>
          `${command.label} ${command.keywords ?? ''} ${command.section}`
            .toLowerCase()
            .includes(needle),
        );
  const safeActive = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [safeActive, open]);

  if (!open) return null;

  let lastSection: string | null = null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[calc(12vh+env(safe-area-inset-top))] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.paletteAria')}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="yu-pop yu-rise w-full max-w-xl overflow-hidden rounded-3xl"
        style={{ animationDuration: '0.35s' }}
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-4">
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                filtered[safeActive]?.run();
              }
            }}
            placeholder={t('palette.searchPlaceholder')}
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-text-tertiary"
            aria-label={t('palette.searchAria')}
          />
          <kbd className="shrink-0 rounded-md bg-chip px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
            Esc
          </kbd>
        </div>
        <ul
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto p-2"
          role="listbox"
          aria-label="Results"
        >
          {filtered.map((command, index) => {
            const header = command.section !== lastSection ? command.section : null;
            lastSection = command.section;
            return (
              <li key={command.id}>
                {header !== null ? <p className="yu-eyebrow px-2.5 pt-2.5 pb-1">{header}</p> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === safeActive}
                  onMouseEnter={() => setActive(index)}
                  onClick={command.run}
                  className={[
                    'flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[13.5px] transition-colors',
                    index === safeActive ? 'bg-chip text-text-primary' : 'text-text-secondary',
                  ].join(' ')}
                >
                  <span className="flex shrink-0 text-text-tertiary [&>svg]:size-4">
                    {command.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint !== undefined ? (
                    <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">
                      {command.hint}
                    </span>
                  ) : null}
                  {index === safeActive ? (
                    <CornerDownLeft className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-text-tertiary">
              Nothing matches “{query}”.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
