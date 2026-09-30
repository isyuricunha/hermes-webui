import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { authPost, fetchAuthState, logout } from '../../lib/auth';

/**
 * Account menu (Phase 1, spec 2.21/2.22): identity, change password,
 * session management and sign out. Visual refresh comes in Phase 2; here it
 * must simply work on desktop and mobile.
 */

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'password' | 'sessions'>('menu');
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const stateQuery = useQuery({
    queryKey: ['auth-state'],
    queryFn: fetchAuthState,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['auth-state'] });
    void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
  };

  const signOut = async () => {
    await logout();
    invalidate();
    window.location.assign('/login');
  };

  const username = stateQuery.data?.user?.username ?? '…';
  const hermesMode = stateQuery.data?.mode !== 'local';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Account menu"
        title={username}
        className="yu-btn yu-btn-ghost size-8 rounded-lg"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
          {username.slice(0, 1).toUpperCase()}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="yu-pop absolute bottom-full left-0 z-50 mb-2 w-64 rounded-2xl p-1.5 md:right-0 md:left-auto"
        >
          {view === 'menu' ? (
            <>
              <div className="px-2.5 pt-1.5 pb-2">
                <p className="truncate text-[13px] font-medium text-text-primary">{username}</p>
                <p className="text-[11px] text-text-tertiary">
                  {hermesMode ? 'Signed in with your Hermes account' : 'Local WebUI account'}
                </p>
              </div>
              {hermesMode ? null : (
                <MenuItem
                  label="Change password"
                  onClick={() => {
                    setView('password');
                  }}
                />
              )}
              <MenuItem
                label="Sessions"
                onClick={() => {
                  setView('sessions');
                }}
              />
              <MenuItem label="Sign out" danger onClick={() => void signOut()} />
            </>
          ) : null}

          {view === 'password' ? (
            <PasswordForm
              onDone={() => {
                setView('menu');
                invalidate();
              }}
              onCancel={() => setView('menu')}
            />
          ) : null}

          {view === 'sessions' ? <SessionsPanel onBack={() => setView('menu')} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'min-h-[38px] w-full rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-chip',
        danger ? 'text-danger' : 'text-text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function PasswordForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (overridePassword?: string) => {
    setError(null);
    setPending(true);
    try {
      const result = needsReauth
        ? await authPost('/api/auth/reauth', { password: overridePassword ?? current })
        : await authPost('/api/auth/password', {
            currentPassword: current,
            newPassword: next,
          });
      if (!result.ok) {
        if (result.errorCode === 'AUTH_REAUTH_REQUIRED' && overridePassword === undefined) {
          setNeedsReauth(true);
          setPending(false);
          return;
        }
        setError(result.errorMessage ?? 'Password change failed.');
        return;
      }
      if (overridePassword !== undefined) {
        // Re-authenticated: retry the change now that recent-auth is fresh.
        const retry = await authPost('/api/auth/password', {
          currentPassword: current,
          newPassword: next,
        });
        if (!retry.ok) {
          setError(retry.errorMessage ?? 'Password change failed.');
          return;
        }
      }
      onDone();
    } catch {
      setError('Server unavailable.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2 p-1">
      <p className="text-[10px] font-semibold tracking-wide text-text-secondary uppercase">
        Change password
      </p>
      {needsReauth ? (
        <label className="block">
          <span className="mb-1 block text-[10px] text-text-secondary">
            Confirm your password to continue
          </span>
          <input
            type="password"
            value={reauthPassword}
            onChange={(event) => setReauthPassword(event.target.value)}
            autoComplete="current-password"
            className="h-9 w-full rounded-lg border border-border-subtle bg-surface px-2 text-xs outline-none focus:border-accent"
          />
        </label>
      ) : null}
      {!needsReauth ? (
        <>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-text-secondary">
              Current password
            </span>
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              className="h-9 w-full rounded-lg border border-border-subtle bg-surface px-2 text-xs outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-text-secondary">
              New password (min 12)
            </span>
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-border-subtle bg-surface px-2 text-xs outline-none focus:border-accent"
            />
          </label>
        </>
      ) : null}
      {error !== null ? <p className="text-[11px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(needsReauth ? reauthPassword : undefined)}
          className="yu-btn yu-btn-primary h-9 flex-1 text-xs"
        >
          {pending ? 'Saving…' : needsReauth ? 'Confirm' : 'Change'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg border border-border-subtle px-3 text-xs text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SessionsPanel({ onBack }: { onBack: () => void }) {
  const query = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: async () => {
      const response = await fetch('/api/auth/sessions', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Failed to list sessions.');
      }
      return (await response.json()) as {
        sessions: { id: string; current: boolean; lastSeenAt: string; userAgent: string | null }[];
      };
    },
  });
  const queryClient = useQueryClient();

  const revokeOthers = useMutation({
    mutationFn: () => authPost('/api/auth/sessions/revoke-others', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] }),
  });

  return (
    <div className="space-y-1 p-1">
      <button
        type="button"
        onClick={onBack}
        className="text-[11px] text-text-secondary hover:text-text-primary"
      >
        ‹ Back
      </button>
      {(query.data?.sessions ?? []).map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] text-text-secondary"
        >
          <span className="min-w-0 truncate">
            {session.current ? 'This session' : session.userAgent ?? 'Other session'}
          </span>
          {session.current ? <span className="shrink-0 text-success">active</span> : null}
        </div>
      ))}
      <button
        type="button"
        disabled={revokeOthers.isPending}
        onClick={() => revokeOthers.mutate()}
        className="min-h-[36px] w-full rounded-lg border border-border-subtle text-xs font-medium hover:bg-surface"
      >
        Sign out other sessions
      </button>
    </div>
  );
}
