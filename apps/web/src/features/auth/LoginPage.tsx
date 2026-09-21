import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { storeCsrfToken } from '../../lib/auth';

/**
 * Login (Phase 1, spec 2.21): username + password. Errors never reveal
 * whether the username exists; rate limiting is enforced server-side.
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
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface p-6"
      >
        <h1 className="text-lg font-semibold tracking-tight">Hermes WebUI</h1>
        <p className="mt-1 text-sm text-text-secondary">Sign in to continue</p>

        <label className="mt-5 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoComplete="username"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        {error !== null ? (
          <p role="alert" className="mt-3 rounded-lg border border-danger px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 h-10 w-full rounded-xl bg-accent text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => void navigate({ to: '/' })}
          className="mt-3 w-full text-center text-xs text-text-secondary hover:text-text-primary"
        >
          Back to home
        </button>
      </form>
    </div>
  );
}
