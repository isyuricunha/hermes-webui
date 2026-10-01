import { useEffect, useState, type ReactNode } from 'react';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { Menu, RotateCw, X } from 'lucide-react';
import { CommandPalette } from '../features/palette/CommandPalette';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useTheme } from '../lib/theme';
import { HeaderSlotContext } from './headerSlot';
import { Toaster } from '../components/Toaster';
import { TooltipHost } from '../components/TooltipHost';
import { DialogHost } from '../components/DialogHost';
import { ShortcutsHost } from '../components/ShortcutsHost';
import { TOGGLE_SIDEBAR_EVENT } from '../lib/events';

/**
 * Primary layout (PRD 10.2): Conversations | Chat. Desktop keeps the sidebar
 * visible and collapsible; mobile turns it into a drawer (PRD 10.3, 55.1).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const { cycle } = useTheme();
  const matchRoute = useMatchRoute();
  const inConversation = matchRoute({ to: '/chat/$sessionId' }) !== false;

  // PRD 30: settings saves signal that a gateway restart may be required.
  useEffect(() => {
    const handler = () => setRestartRequired(true);
    window.addEventListener('hermes-webui:restart-required', handler);
    return () => window.removeEventListener('hermes-webui:restart-required', handler);
  }, []);

  // Ctrl/Cmd+Shift+S: collapse/expand on desktop, open/close the drawer on phones.
  useEffect(() => {
    const handler = () => {
      if (window.matchMedia('(min-width: 768px)').matches) {
        setCollapsed((value) => !value);
      } else {
        setDrawerOpen((value) => !value);
      }
    };
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, handler);
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
      <header className="safe-top-bar fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border-subtle bg-background/85 backdrop-blur-md md:hidden">
        <button
          type="button"
          className="yu-btn yu-btn-ghost size-9"
          aria-label="Open conversations"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-[18px]" aria-hidden />
        </button>
        {inConversation ? (
          <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center" />
        ) : (
          <Link to="/" className="text-[15px] font-medium tracking-[-0.01em]" aria-label="Hermes WebUI home">
            Hermes
          </Link>
        )}
      </header>

      {/* Backdrop for the mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] md:hidden"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside
        className={[
          'safe-drawer fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border-subtle bg-surface',
          'transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed ? 'w-[60px]' : 'w-[284px]',
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

      <main className="safe-below-bar flex min-w-0 flex-1 flex-col">
        <HeaderSlotContext.Provider value={inConversation ? headerSlot : null}>{children}</HeaderSlotContext.Provider>
      </main>

      {/* Restart-required banner (PRD 30) */}
      {restartRequired ? (
        <div
          role="status"
          className="yu-pop fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs md:left-auto md:right-4 md:w-[26rem]"
        >
          <span className="text-text-secondary">Changes saved. A gateway restart may be required.</span>
          <span className="flex items-center gap-1.5">
            <Link
              to="/settings/system"
              className="yu-btn yu-btn-primary h-8 px-3 text-xs"
              onClick={() => setRestartRequired(false)}
            >
              <RotateCw className="size-3.5" aria-hidden />
              Restart Hermes
            </Link>
            <button
              type="button"
              aria-label="Dismiss restart notice"
              className="yu-btn yu-btn-ghost size-8"
              onClick={() => setRestartRequired(false)}
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        </div>
      ) : null}

      <CommandPalette onCycleTheme={cycle} />
      <Toaster />
      <TooltipHost />
      <DialogHost />
      <ShortcutsHost />
    </div>
  );
}
