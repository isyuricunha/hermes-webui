import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CommandPalette } from '../features/palette/CommandPalette';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useTheme } from '../lib/theme';

/**
 * Primary layout (PRD 10.2): Conversations | Chat | Optional Context Panel.
 * Desktop keeps the sidebar visible and collapsible; mobile turns it into a
 * drawer (PRD 10.3, 55.1). The context panel arrives in Phase 2.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const { cycle } = useTheme();

  // PRD 30: settings saves signal that a gateway restart may be required.
  useEffect(() => {
    const handler = () => setRestartRequired(true);
    window.addEventListener('hermes-webui:restart-required', handler);
    return () => window.removeEventListener('hermes-webui:restart-required', handler);
  }, []);

  // /sessions command (and other surfaces) can open the conversations drawer.
  useEffect(() => {
    const handler = () => {
      setDrawerOpen(true);
      setCollapsed(false);
    };
    window.addEventListener('hermes-webui:open-sessions', handler);
    return () => window.removeEventListener('hermes-webui:open-sessions', handler);
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-text-primary">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-border-subtle bg-surface px-3 md:hidden">
        <button
          type="button"
          className="rounded-md border border-border-subtle px-2 py-1 text-sm"
          aria-label="Open conversations"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <span className="text-sm font-medium">
          <Link to="/" className="hover:text-text-primary" aria-label="Hermes WebUI home">
            Hermes WebUI
          </Link>
        </span>
      </header>

      {/* Backdrop for the mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border-subtle bg-surface',
          'transition-all duration-200 md:static md:translate-x-0',
          'pt-12 md:pt-0',
          collapsed ? 'w-14' : 'w-72',
          drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
        aria-label="Conversations"
      >
        <SessionSidebar
          collapsed={collapsed}
          onCollapseToggle={() => setCollapsed((value) => !value)}
          onNavigate={() => setDrawerOpen(false)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col pt-12 md:pt-0">{children}</main>

      {/* Restart-required banner (PRD 30) */}
      {restartRequired ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-warning bg-surface-elevated px-4 py-2 text-xs"
        >
          <span>Changes saved. A gateway restart may be required to apply them.</span>
          <span className="flex items-center gap-2">
            <Link
              to="/settings/system"
              className="rounded-lg bg-accent px-3 py-1 font-medium text-white"
              onClick={() => setRestartRequired(false)}
            >
              Restart Hermes
            </Link>
            <button
              type="button"
              aria-label="Dismiss restart notice"
              className="text-text-secondary hover:text-text-primary"
              onClick={() => setRestartRequired(false)}
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      <CommandPalette onCycleTheme={cycle} />
    </div>
  );
}
