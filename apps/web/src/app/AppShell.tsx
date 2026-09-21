import type { ReactNode } from 'react';
import { SessionSidebar } from '../features/sessions/SessionSidebar';

/**
 * Primary layout (PRD 10.2): Conversations | Chat | Optional Context Panel.
 * The context panel arrives in Phase 2; the sidebar becomes a drawer on
 * mobile (PRD 10.3, 55.1).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-text-primary">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border-subtle bg-surface md:flex">
        <SessionSidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
