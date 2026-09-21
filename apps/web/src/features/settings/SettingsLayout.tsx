import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

function sectionTitle(pathname: string): string {
  const match = NAV.filter((item) => pathname.startsWith(item.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  if (match !== undefined) return match.label;
  if (pathname.includes('/field')) return 'Setting';
  return 'Settings';
}

/**
 * Settings is its own workspace (PRD 6.2, 19).
 *
 * Desktop (>=md): persistent two-pane navigation | content.
 * Mobile: single pane at full width; navigation lives in a drawer opened
 * from the top bar (hamburger), closed by selection, backdrop or Escape.
 */
export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const schemaQuery = useQuery({
    queryKey: ['settings-schema'],
    queryFn: fetchConfigSchema,
    staleTime: 5 * 60_000,
  });
  const hits = query.trim() === '' ? [] : searchSchema(schemaQuery.data?.fields ?? {}, query, 12);

  // Escape closes the drawer (keyboard environments).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const activeSection = sectionTitle(location.pathname);

  const navContent = (
    <div className="flex h-full flex-col">
      <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Settings
      </p>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search settings…"
        aria-label="Search settings"
        className="mb-3 h-9 w-full rounded-lg border border-border-subtle bg-surface-elevated px-2.5 text-xs outline-none focus:border-accent"
      />
      {query.trim() !== '' ? (
        <ul className="mb-3 space-y-0.5">
          {hits.map((hit) => (
            <li key={hit.path}>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setDrawerOpen(false);
                  void navigate({
                    to: '/settings/field',
                    search: { path: hit.path },
                  });
                }}
                className="block w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-surface-elevated"
                title={hit.path}
              >
                <span className="font-medium">{hit.label}</span>
                <span className="block break-all font-mono text-[10px] text-text-secondary">
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
                  onClick={() => setDrawerOpen(false)}
                  className={[
                    'block rounded-lg px-3 py-2.5 text-sm',
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
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col md:flex-row">
      {/* Mobile top bar: hamburger + current section (PRD mobile spec) */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-border-subtle bg-surface px-3 md:hidden">
        <button
          type="button"
          className="min-h-[44px] min-w-[44px] rounded-md border border-border-subtle text-sm"
          aria-label="Open Settings navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <span className="truncate text-sm font-medium">{activeSection}</span>
      </header>

      {/* Mobile drawer backdrop */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      {/* Navigation: drawer on mobile, persistent column on desktop */}
      <nav
        aria-label="Settings"
        className={[
          'fixed inset-y-0 left-0 z-40 w-72 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface p-3',
          'transition-transform duration-200 md:static md:w-56 md:translate-x-0 md:pt-3',
          drawerOpen ? 'translate-x-0 pt-12 md:pt-3' : '-translate-x-full pt-12 md:pt-3',
        ].join(' ')}
      >
        {navContent}
      </nav>

      {/* Content: full available width, own scroll */}
      <div className="min-w-0 flex-1 overflow-y-auto pt-12 md:pt-0">
        <Outlet />
      </div>
    </div>
  );
}

export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
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
