import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { createSession, deleteSession, fetchAppStatus, fetchSessions, forkSession, patchSession } from '../../lib/api';
import { ThemeToggle } from './ThemeToggle';

function HermesStatusPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    retry: false,
  });

  if (isPending) {
    return <span className="text-xs text-text-secondary">Hermes: Connecting…</span>;
  }
  if (isError || data.hermes.state === 'offline') {
    return <span className="text-xs font-medium text-danger">Hermes: Offline</span>;
  }
  if (data.hermes.state === 'degraded') {
    return <span className="text-xs font-medium text-warning">Hermes: Degraded</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <span className="inline-block size-1.5 rounded-full bg-success" aria-hidden />
      Hermes: Connected
    </span>
  );
}

function sessionLabel(id: string, title: string | null): string {
  return title ?? id;
}

function groupLabel(startedAt: number): 'Today' | 'Earlier' {
  const start = new Date(startedAt * 1000);
  const now = new Date();
  return start.toDateString() === now.toDateString() ? 'Today' : 'Earlier';
}

/**
 * Sidebar structure follows PRD 9.1: new chat, grouped conversations,
 * connection status and Settings at the bottom. Sessions are real Hermes
 * sessions; pins/archive and sidebar width are WebUI-owned (PRD 11.3, 51).
 */
export function SessionSidebar({ onNavigate }: { onNavigate?: () => void }) {
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
  const groups = new Map<'Today' | 'Earlier', typeof sessions>();
  for (const session of sessions) {
    const label = groupLabel(session.started_at);
    const list = groups.get(label) ?? [];
    list.push(session);
    groups.set(label, list);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={() => newChat.mutate()}
          disabled={newChat.isPending}
          className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-left text-sm font-medium hover:bg-surface disabled:opacity-50"
        >
          + New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Conversations">
        {sessionsQuery.isPending ? (
          <p className="px-1 py-2 text-sm text-text-secondary">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="px-1 py-2 text-sm text-text-secondary">No conversations yet.</p>
        ) : (
          (['Today', 'Earlier'] as const).map((label) => {
            const list = groups.get(label) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={label}>
                <p className="px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
                  {label}
                </p>
                <ul>
                  {list.map((session) => (
                    <li key={session.id} className="group relative">
                      <Link
                        to="/chat/$sessionId"
                        params={{ sessionId: session.id }}
                        onClick={onNavigate}
                        className="block truncate rounded-lg px-2 py-1.5 pr-20 text-sm hover:bg-surface-elevated"
                        title={sessionLabel(session.id, session.title)}
                      >
                        {sessionLabel(session.id, session.title)}
                      </Link>
                      <span className="absolute top-1.5 right-2 hidden gap-1 group-hover:flex">
                        <button
                          type="button"
                          aria-label={`Rename ${sessionLabel(session.id, session.title)}`}
                          className="rounded px-1 text-xs text-text-secondary hover:text-text-primary"
                          onClick={() => {
                            const title = window.prompt('New title:', session.title ?? '');
                            if (title !== null && title.trim() !== '') {
                              rename.mutate({ id: session.id, title: title.trim() });
                            }
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          aria-label={`Fork ${sessionLabel(session.id, session.title)}`}
                          className="rounded px-1 text-xs text-text-secondary hover:text-text-primary"
                          title="Fork this conversation"
                          onClick={() => fork.mutate(session.id)}
                        >
                          ⑂
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${sessionLabel(session.id, session.title)}`}
                          className="rounded px-1 text-xs text-text-secondary hover:text-danger"
                          onClick={() => {
                            if (window.confirm(`Delete "${sessionLabel(session.id, session.title)}"?`)) {
                              remove.mutate(session.id);
                            }
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-3 py-3">
        <HermesStatusPill />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            to="/settings"
            onClick={onNavigate}
            className="text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
