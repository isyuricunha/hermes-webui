import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { storeCsrfToken } from '../../lib/auth';

/**
 * First-boot setup (Phase 1, spec 2.7/2.21): claim the instance with the
 * one-time setup token written to the server's data directory.
 */

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [setupToken, setSetupToken] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('auth.setup.passwordsMismatch'));
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          setupToken,
          username,
          displayName: displayName || undefined,
          password,
        }),
      });
      const body = (await response.json()) as {
        csrfToken?: string;
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        if (body.error?.code === 'SETUP_ALREADY_CLAIMED') {
          window.location.assign('/login');
          return;
        }
        setError(body.error?.message ?? t('auth.setup.failed'));
        return;
      }
      storeCsrfToken(body.csrfToken ?? null);
      window.location.assign('/');
    } catch {
      setError(t('auth.serverUnavailable'));
    } finally {
      setPending(false);
    }
  };

  void navigate;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface p-6"
      >
        <h1 className="text-lg font-semibold tracking-tight">Hermes WebUI</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('auth.setup.title')}</p>

        <label className="mt-5 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t('auth.setup.token')}
          </span>
          <input
            type="password"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
            required
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-text-secondary">
            {t('auth.setup.tokenHint')}
          </span>
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t('auth.username')}
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
            maxLength={64}
            autoComplete="username"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t('auth.setup.displayName')}
          </span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t('auth.password')}
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            maxLength={1024}
            autoComplete="new-password"
            aria-label={t('auth.password')}
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
          <span className="mt-1 block text-[11px] text-text-secondary">
            {t('auth.setup.minChars')}
          </span>
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t('auth.setup.confirmPassword')}
          </span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            autoComplete="new-password"
            aria-label={t('auth.setup.confirmPassword')}
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          />
        </label>

        {error !== null ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-danger px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="yu-btn yu-btn-primary mt-5 h-10 w-full text-sm"
        >
          {pending ? t('auth.setup.working') : t('auth.setup.createOwner')}
        </button>
      </form>
    </div>
  );
}
