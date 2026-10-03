import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen, Search, Settings, SquarePen } from 'lucide-react';
import {
  deleteSession,
  fetchAppStatus,
  fetchSessions,
  forkSession,
  patchSession,
  type SessionRow,
} from '../../lib/api';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from '../auth/AccountMenu';
import { derivedTitle } from '../../lib/sessionTitles';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { FOCUS_COMPOSER_EVENT } from '../../lib/events';
import { SessionItem } from './SessionItem';
import { SessionSearch } from './SessionSearch';

function HermesStatusPill() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    retry: false,
  });

  const state = isPending
    ? 'connecting'
    : isError || data.hermes.state === 'offline'
      ? 'offline'
      : data.hermes.state;
  const label =
    state === 'connecting'
      ? t('sessions.statusConnecting')
      : state === 'offline'
        ? t('sessions.statusOffline')
        : state === 'degraded'
          ? t('sessions.statusDegraded')
          : t('sessions.statusConnected');
  const dot =
    state === 'offline'
      ? 'bg-danger text-danger'
      : state === 'connected'
        ? 'bg-success text-success'
        : 'bg-warning text-warning';
  return (
    <span
      className={[
        'inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs text-text-secondary',
        state === 'connected' ? 'yu-sheen' : 'border border-border-subtle',
      ].join(' ')}
    >
      <span
        className={['size-1.5 rounded-full', dot, state === 'connected' ? 'yu-pulse' : ''].join(
          ' ',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

/**
 * Display title hierarchy (Chat UX goal): Hermes-provided title, then the
 * WebUI-derived title from the first user message, then a friendly fallback.
 * Raw technical session ids (api_*) never render as the primary label — they
 * stay in the tooltip/debug metadata.
 */
function sessionLabel(id: string, title: string | null, fallback: string): string {
  if (title !== null && title.trim() !== '' && !/^[a-z0-9_]+_[0-9]{6,}_?[a-f0-9]*$/i.test(title)) {
    return title;
  }
  return derivedTitle(id) ?? fallback;
}

const GROUPS = [
  'sessions.group.pinned',
  'sessions.group.today',
  'sessions.group.yesterday',
  'sessions.group.last7Days',
  'sessions.group.older',
] as const;
type GroupKey = (typeof GROUPS)[number];

function groupKey(session: SessionRow, now = new Date()): GroupKey {
  if (session.pinned === true) return 'sessions.group.pinned';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = (session.last_active ?? session.started_at) * 1000;
  if (at >= startOfToday) return 'sessions.group.today';
  if (at >= startOfToday - 86_400_000) return 'sessions.group.yesterday';
  if (at >= startOfToday - 7 * 86_400_000) return 'sessions.group.last7Days';
  return 'sessions.group.older';
}

interface SessionSidebarProps {
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  onNavigate?: () => void;
}

/**
 * Sidebar (PRD 9.1): new chat, full-text search, pinned + date-grouped
 * conversations from every source, and status/settings/account at the
 * bottom. Pin/archive/title live in Hermes (the same flags Hermes Desktop
 * uses), so they follow the conversation everywhere.
 */
export function SessionSidebar({
  collapsed = false,
  onCollapseToggle,
  onNavigate,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(80),
    // Keep the sidebar fresh while platform surfaces (e.g. Telegram) create
    // or update sessions outside the WebUI.
    refetchInterval: 10000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  // A new chat is just the empty composer: the conversation is created when
  // the first message is sent, so abandoned "New chat" rows never pile up.
  const newChat = {
    isPending: false,
    mutate: () => {
      void navigate({ to: '/' });
      onNavigate?.();
      window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)), 50);
    },
  };

  const patch = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { title?: string; pinned?: boolean; archived?: boolean };
    }) => patchSession(id, body),
    onSuccess: (_data, variables) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['session-detail', variables.id] });
    },
    onError: (error) => toastError(error),
  });

  const fork = async (id: string) => {
    try {
      const created = await forkSession(id);
      invalidate();
      toast(t('sessions.forked'), 'success');
      void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
      onNavigate?.();
    } catch (error) {
      toastError(error);
    }
  };

  const archive = (id: string, name: string) => {
    patch.mutate(
      { id, body: { archived: true } },
      {
        onSuccess: () =>
          toast(t('sessions.archived', { name }), 'success', {
            action: {
              label: t('common.undo'),
              onClick: () => patch.mutate({ id, body: { archived: false } }),
            },
          }),
      },
    );
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: t('sessions.deleteTitle'),
      description: t('sessions.deleteDescription', { name }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSession(id);
      invalidate();
      toast(t('sessions.deleted'), 'success');
      if (window.location.pathname === `/chat/${encodeURIComponent(id)}`) {
        void navigate({ to: '/' });
      }
    } catch (error) {
      toastError(error);
    }
  };

  const sessions = [...(sessionsQuery.data?.data ?? [])]
    .filter((session) => session.archived !== true)
    .sort((a, b) => (b.last_active ?? b.started_at) - (a.last_active ?? a.started_at));
  const groups = new Map<GroupKey, SessionRow[]>();
  for (const session of sessions) {
    const key = groupKey(session);
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }

  const iconButton = 'yu-btn yu-btn-ghost size-8 rounded-lg';
  const searching = query.trim().length >= 2;

  return (
    <div className="flex h-full flex-col">
      <div
        className={['flex items-center gap-1 px-3 pt-3 pb-2', collapsed ? 'flex-col' : ''].join(
          ' ',
        )}
      >
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
          aria-label={collapsed ? t('sessions.expand') : t('sessions.collapse')}
          title={collapsed ? t('sessions.expand') : t('sessions.collapse')}
          className={[iconButton, 'hidden md:inline-flex'].join(' ')}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>

      <div className={collapsed ? 'flex flex-col items-center gap-1 px-3 pb-2' : 'px-3 pb-2'}>
        <button
          type="button"
          onClick={() => newChat.mutate()}
          disabled={newChat.isPending}
          aria-label={t('sessions.newChat')}
          title={`${t('sessions.newChat')} (Ctrl+Shift+O)`}
          className={
            collapsed
              ? iconButton
              : 'yu-btn yu-btn-secondary h-9 w-full justify-start rounded-xl px-3 text-[13px]'
          }
        >
          <SquarePen className="size-4" aria-hidden />
          {collapsed ? null : <span>{t('sessions.newChat')}</span>}
        </button>
        {collapsed ? (
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-label={t('sessions.searchAria')}
            title={t('sessions.searchAria')}
            className={iconButton}
          >
            <Search className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex-1" />
      ) : (
        <>
          <SessionSearch query={query} onQueryChange={setQuery} onNavigate={onNavigate} />
          {searching ? (
            <div className="flex-1" />
          ) : (
            <nav
              className="flex-1 overflow-y-auto px-2 pb-3"
              aria-label={t('sessions.conversationsAria')}
            >
              {sessionsQuery.isPending ? (
                <div className="space-y-2.5 px-2 pt-2" aria-label={t('sessions.loadingAria')}>
                  {[72, 54, 64, 40].map((width) => (
                    <div key={width} className="yu-skel h-3" style={{ width: `${width}%` }} />
                  ))}
                </div>
              ) : sessionsQuery.isError ? (
                <p className="px-2 py-2 text-[13px] text-danger">{t('sessions.loadFailed')}</p>
              ) : sessions.length === 0 ? (
                <p className="px-2 py-2 text-[13px] text-text-tertiary">{t('sessions.none')}</p>
              ) : (
                GROUPS.map((key) => {
                  const list = groups.get(key) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={key} className="mb-2">
                      <p className="yu-eyebrow px-2.5 pt-2 pb-1">{t(key)}</p>
                      <ul>
                        {list.map((session) => {
                          const name = sessionLabel(
                            session.id,
                            session.title,
                            t('sessions.newChat'),
                          );
                          return (
                            <SessionItem
                              key={session.id}
                              id={session.id}
                              name={name}
                              source={session.source}
                              pinned={session.pinned === true}
                              onNavigate={onNavigate}
                              actions={{
                                onRename: (title) =>
                                  patch.mutate({ id: session.id, body: { title } }),
                                onTogglePin: () =>
                                  patch.mutate({
                                    id: session.id,
                                    body: { pinned: session.pinned !== true },
                                  }),
                                onFork: () => void fork(session.id),
                                onArchive: () => archive(session.id, name),
                                onDelete: () => void remove(session.id, name),
                              }}
                            />
                          );
                        })}
                      </ul>
                    </div>
                  );
                })
              )}
            </nav>
          )}
        </>
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
            aria-label={t('settings.title')}
            title={t('settings.title')}
            className={
              collapsed
                ? iconButton
                : 'yu-btn yu-btn-ghost h-8 flex-1 justify-start rounded-lg px-2 text-[13px]'
            }
          >
            <Settings className="size-4" aria-hidden />
            {collapsed ? null : <span>{t('settings.title')}</span>}
          </Link>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </div>
  );
}
