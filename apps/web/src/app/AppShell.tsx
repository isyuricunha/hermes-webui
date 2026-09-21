import { useState, type ReactNode } from 'react';
import { CommandPalette } from '../features/palette/CommandPalette';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useTheme } from '../lib/theme';

/**
 * Primary layout (PRD 10.2): Conversations | Chat | Optional Context Panel.
 * Desktop keeps the sidebar visible; mobile turns it into a drawer
 * (PRD 10.3, 55.1). The context panel arrives in Phase 2.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { cycle } = useTheme();

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
        <span className="text-sm font-medium">Hermes WebUI</span>
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
          'fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-border-subtle bg-surface',
          'transition-transform duration-200 md:static md:translate-x-0',
          drawerOpen ? 'translate-x-0 pt-12 md:pt-0' : '-translate-x-full pt-12 md:pt-0',
        ].join(' ')}
        aria-label="Conversations"
      >
        <SessionSidebar onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col pt-12 md:pt-0">{children}</main>

      <CommandPalette onCycleTheme={cycle} />
    </div>
  );
}
