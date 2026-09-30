import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { storeCsrfToken, useAuthState } from '../../lib/auth';

/**
 * Login (Phase 1, spec 2.21): username + password. Errors never reveal
 * whether the username exists; rate limiting is enforced server-side. In auth
 * mode "hermes" the credentials are the Hermes dashboard's own.
 */

interface LoginSearch {
  next?: string;
}

function safeNextPath(next: string | undefined): string {
  // Only same-origin absolute paths; no open redirects (spec 2.20).
  if (next === undefined || next === '' || !next.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  return next;
}

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' }) as LoginSearch;
  const authState = useAuthState();
  const hermesMode = authState.data?.mode !== 'local';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = (await response.json()) as {
        csrfToken?: string;
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? 'Sign in failed.');
        return;
      }
      storeCsrfToken(body.csrfToken ?? null);
      const next = safeNextPath(search.next);
      window.location.assign(next);
    } catch {
      setError('Server unavailable.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="yu-rise mb-8 text-center" style={{ ['--yu-delay' as string]: '0ms' }}>
          <h1 className="text-[44px] leading-none font-normal tracking-[-0.03em]">
            <span className="yu-shimmer-gold italic">Hermes</span>
          </h1>
          <p className="mt-3 text-sm text-text-secondary">Sign in to continue</p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="yu-card yu-rise rounded-3xl p-6"
          style={{ ['--yu-delay' as string]: '100ms' }}
        >
          <label className="block">
            <span className="yu-eyebrow mb-1.5 block">Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="yu-input h-11 w-full px-3.5 text-sm"
            />
          </label>

          <label className="mt-4 block">
            <span className="yu-eyebrow mb-1.5 block">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className="yu-input h-11 w-full px-3.5 text-sm"
            />
          </label>

          {error !== null ? (
            <p role="alert" className="yu-chip-danger mt-4 rounded-xl px-3 py-2 text-xs">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="yu-btn yu-btn-primary mt-6 h-11 w-full text-sm">
            {pending ? <span>Signing in…</span> : (
              <>
                <span>Sign in</span>
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>

          {hermesMode ? (
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-text-tertiary">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Use the same username and password as your Hermes dashboard.</span>
            </p>
          ) : null}
        </form>

        <button
          type="button"
          onClick={() => void navigate({ to: '/' })}
          className="mt-5 w-full text-center text-xs text-text-tertiary transition-colors hover:text-text-primary"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
