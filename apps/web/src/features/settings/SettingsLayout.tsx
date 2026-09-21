import { Link, Outlet, useLocation } from '@tanstack/react-router';

const NAV = [
  { to: '/settings/models', label: 'Models' },
  { to: '/settings/mcp', label: 'MCP' },
  { to: '/settings/skills', label: 'Skills' },
  { to: '/settings/cron', label: 'Cron' },
  { to: '/settings/messaging', label: 'Messaging' },
  { to: '/settings/system', label: 'System' },
  { to: '/settings/advanced/config', label: 'Raw Config' },
  { to: '/settings/advanced/environment', label: 'Environment' },
] as const;

/**
 * Settings is its own workspace (PRD 6.2, 19): semantic navigation on the
 * left, content on the right. Areas whose curated UI is not built yet are
 * reachable through Raw Config and Environment.
 */
export function SettingsLayout() {
  const location = useLocation();
  return (
    <div className="flex h-full min-h-0 w-full">
      <nav
        aria-label="Settings"
        className="w-56 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface p-3"
      >
        <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">
          Settings
        </p>
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
