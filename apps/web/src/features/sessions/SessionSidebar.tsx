import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Clock,
  GitFork,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Send,
  Settings,
  SquarePen,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import {
  createSession,
  deleteSession,
  fetchAppStatus,
  fetchSessions,
  forkSession,
  patchSession,
} from '../../lib/api';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from '../auth/AccountMenu';
import { derivedTitle } from '../../lib/sessionTitles';

function HermesStatusPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    retry: false,
  });

  const state = isPending ? 'connecting' : isError || data.hermes.state === 'offline' ? 'offline' : data.hermes.state;
  const label =
    state === 'connecting'
      ? 'Hermes: Connecting…'
      : state === 'offline'
        ? 'Hermes: Offline'
        : state === 'degraded'
          ? 'Hermes: Degraded'
          : 'Hermes: Connected';
  const dot =
    state === 'offline' ? 'bg-danger text-danger' : state === 'connected' ? 'bg-success text-success' : 'bg-warning text-warning';
  return (
    <span
      className={[
        'inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs text-text-secondary',
        state === 'connected' ? 'yu-sheen' : 'border border-border-subtle',
      ].join(' ')}
    >
      <span className={['size-1.5 rounded-full', dot, state === 'connected' ? 'yu-pulse' : ''].join(' ')} aria-hidden />
      {label}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  cron: 'Cron',
  cli: 'CLI',
  tui: 'Terminal',
};

function SourceIcon({ source }: { source: string }) {
  const key = source.toLowerCase();
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

/**
 * Display title hierarchy (Chat UX goal): Hermes-provided title, then the
 * WebUI-derived title from the first user message, then a friendly fallback.
 * Raw technical session ids (api_*) never render as the primary label — they
 * stay in the tooltip/debug metadata.
 */
function sessionLabel(id: string, title: string | null): string {
  if (title !== null && title.trim() !== '' && !/^[a-z0-9_]+_[0-9]{6,}_?[a-f0-9]*$/i.test(title)) {
    return title;
  }
  return derivedTitle(id) ?? 'New chat';
}

const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;
type GroupLabel = (typeof GROUPS)[number];

function groupLabel(startedAt: number, now = new Date()): GroupLabel {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const started = startedAt * 1000;
  if (started >= startOfToday) return 'Today';
  if (started >= startOfToday - 86_400_000) return 'Yesterday';
  if (started >= startOfToday - 7 * 86_400_000) return 'Previous 7 days';
  return 'Older';
}

interface SessionSidebarProps {
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  onNavigate?: () => void;
}

/**
 * Sidebar structure follows PRD 9.1: new chat, grouped conversations,
 * connection status and Settings at the bottom. Sessions are real Hermes
 * sessions; pins/archive and sidebar width are WebUI-owned (PRD 11.3, 51).
 * Collapsed mode keeps only the primary actions (PRD 6.6 progressive
 * disclosure).
 */
export function SessionSidebar({
  collapsed = false,
  onCollapseToggle,
  onNavigate,
}: SessionSidebarProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(50),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const newChat = useMutation({
    mutationFn: () => createSession({}),
    onSuccess: (created) => {
      invalidate();
      void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
      onNavigate?.();
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => patchSession(id, { title }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: invalidate,
  });

  const fork = useMutation({
    mutationFn: (id: string) => forkSession(id),
    onSuccess: (created) => {
      invalidate();
      if (created?.session?.id) {
        void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
      }
      onNavigate?.();
    },
  });

  const sessions = [...(sessionsQuery.data?.data ?? [])].sort((a, b) => b.started_at - a.started_at);
  const groups = new Map<GroupLabel, typeof sessions>();
  for (const session of sessions) {
    const label = groupLabel(session.started_at);
    const list = groups.get(label) ?? [];
    list.push(session);
    groups.set(label, list);
  }

  const iconButton = 'yu-btn yu-btn-ghost size-8 rounded-lg';

  return (
    <div className="flex h-full flex-col">
      <div className={['flex items-center gap-1 px-3 pt-3 pb-2', collapsed ? 'flex-col' : ''].join(' ')}>
        {collapsed ? null : (
          <Link
            to="/"
            onClick={onNavigate}
            className="flex-1 px-1.5 text-[17px] font-medium tracking-[-0.02em] text-text-primary"
            aria-label="Hermes WebUI home"
          >
            Hermes
          </Link>
        )}
        <button
          type="button"
          onClick={onCollapseToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={[iconButton, 'hidden md:inline-flex'].join(' ')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>

      <div className={collapsed ? 'flex justify-center px-3 pb-2' : 'px-3 pb-3'}>
        <button
          type="button"
          onClick={() => newChat.mutate()}
          disabled={newChat.isPending}
          aria-label="New chat"
          title="New chat"
          className={
            collapsed
              ? iconButton
              : 'yu-btn yu-btn-secondary h-9 w-full justify-start rounded-xl px-3 text-[13px]'
          }
        >
          <SquarePen className="size-4" aria-hidden />
          {collapsed ? null : <span>New chat</span>}
        </button>
      </div>

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
          {sessionsQuery.isPending ? (
            <div className="space-y-2.5 px-2 pt-2" aria-label="Loading sessions">
              {[72, 54, 64, 40].map((width) => (
                <div key={width} className="yu-skel h-3" style={{ width: `${width}%` }} />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-text-tertiary">No conversations yet.</p>
          ) : (
            GROUPS.map((label) => {
              const list = groups.get(label) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={label} className="mb-2">
                  <p className="yu-eyebrow px-2.5 pt-2 pb-1">{label}</p>
                  <ul>
                    {list.map((session) => {
                      const name = sessionLabel(session.id, session.title);
                      return (
                        <li key={session.id} className="group relative">
                          <Link
                            to="/chat/$sessionId"
                            params={{ sessionId: session.id }}
                            onClick={onNavigate}
                            className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-text-secondary transition-colors hover:bg-surface-input hover:text-text-primary"
                            activeProps={{ className: 'bg-chip !text-text-primary' }}
                            title={`${name} (${session.id})`}
                          >
                            <SourceIcon source={session.source} />
                            <span className="min-w-0 flex-1 truncate group-hover:pr-20 group-focus-within:pr-20">{name}</span>
                          </Link>
                          <span className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 gap-0.5 group-hover:flex group-focus-within:flex">
                            <button
                              type="button"
                              aria-label={`Rename ${name}`}
                              title="Rename"
                              className="yu-btn yu-btn-ghost size-7 rounded-md"
                              onClick={() => {
                                const title = window.prompt('New title:', session.title ?? '');
                                if (title !== null && title.trim() !== '') {
                                  rename.mutate({ id: session.id, title: title.trim() });
                                }
                              }}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              aria-label={`Fork ${name}`}
                              title="Fork this conversation"
                              className="yu-btn yu-btn-ghost size-7 rounded-md"
                              onClick={() => fork.mutate(session.id)}
                            >
                              <GitFork className="size-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${name}`}
                              title="Delete"
                              className="yu-btn yu-btn-ghost size-7 rounded-md hover:!text-danger"
                              onClick={() => {
                                if (window.confirm(`Delete "${name}"?`)) {
                                  remove.mutate(session.id);
                                }
                              }}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </nav>
      )}

      <div
        className={[
          'flex flex-col gap-2 border-t border-border-subtle p-3',
          collapsed ? 'items-center' : '',
        ].join(' ')}
      >
        {collapsed ? null : <HermesStatusPill />}
        <div className={['flex w-full items-center gap-1', collapsed ? 'flex-col' : ''].join(' ')}>
          <Link
            to="/settings"
            onClick={onNavigate}
            aria-label="Settings"
            title="Settings"
            className={collapsed ? iconButton : 'yu-btn yu-btn-ghost h-8 flex-1 justify-start rounded-lg px-2 text-[13px]'}
          >
            <Settings className="size-4" aria-hidden />
            {collapsed ? null : <span>Settings</span>}
          </Link>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </div>
  );
}
