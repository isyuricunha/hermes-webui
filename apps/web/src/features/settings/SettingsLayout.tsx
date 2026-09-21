import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchConfigSchema } from '../../lib/api';
import { searchSchema } from '../../lib/settingsSearch';

const NAV = [
  { to: '/settings/models', label: 'Models' },
  { to: '/settings/mcp', label: 'MCP' },
  { to: '/settings/skills', label: 'Skills' },
  { to: '/settings/cron', label: 'Cron' },
  { to: '/settings/messaging', label: 'Messaging' },
  { to: '/settings/system', label: 'System' },
  { to: '/settings/advanced/config', label: 'Raw Config' },
  { to: '/settings/advanced/environment', label: 'Environment' },
  { to: '/settings/advanced/cli', label: 'Hermes CLI' },
] as const;

/**
 * Settings is its own workspace (PRD 6.2, 19): semantic navigation on the
 * left, content on the right. Areas whose curated UI is not built yet are
 * reachable through Raw Config and Environment.
 */
export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const schemaQuery = useQuery({
    queryKey: ['settings-schema'],
    queryFn: fetchConfigSchema,
    staleTime: 5 * 60_000,
  });
  const hits = query.trim() === '' ? [] : searchSchema(schemaQuery.data?.fields ?? {}, query, 12);

  return (
    <div className="flex h-full min-h-0 w-full">
      <nav
        aria-label="Settings"
        className="w-56 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface p-3"
      >
        <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">
          Settings
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
          className="mb-3 h-8 w-full rounded-lg border border-border-subtle bg-surface-elevated px-2.5 text-xs outline-none focus:border-accent"
        />
        {query.trim() !== '' ? (
          <ul className="mb-3 space-y-0.5">
            {hits.map((hit) => (
              <li key={hit.path}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    void navigate({
                      to: '/settings/field',
                      search: { path: hit.path },
                    });
                  }}
                  className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-elevated"
                  title={hit.path}
                >
                  <span className="font-medium">{hit.label}</span>
                  <span className="block truncate font-mono text-[10px] text-text-secondary">
                    {hit.path}
                  </span>
                </button>
              </li>
            ))}
            {hits.length === 0 ? (
              <li className="px-2 py-1 text-xs text-text-secondary">No matches.</li>
            ) : null}
          </ul>
        ) : (
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={[
                    'block rounded-lg px-3 py-1.5 text-sm',
                    active
                      ? 'bg-surface-elevated font-medium text-text-primary'
                      : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        )}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export function SettingsError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-danger bg-surface-elevated px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
