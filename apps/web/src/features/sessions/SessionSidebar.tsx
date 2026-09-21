import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchAppStatus } from '../../lib/api';

function HermesStatusPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    retry: false,
  });

  if (isPending) {
    return <span className="text-xs text-text-secondary">Hermes: Connecting…</span>;
  }
  if (isError || data.hermes.state !== 'connected') {
    return <span className="text-xs font-medium text-danger">Hermes: Offline</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <span className="inline-block size-1.5 rounded-full bg-success" aria-hidden />
      Hermes: Connected
    </span>
  );
}

/**
 * Sidebar structure follows PRD 9.1: new chat, grouped conversations,
 * connection status and Settings at the bottom. Session listing is wired to
 * real Hermes sessions in Phase 2; grouping/pinning metadata is WebUI-owned
 * (PRD 11.3, 51).
 */
export function SessionSidebar() {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-left text-sm font-medium hover:bg-surface"
          aria-label="New chat"
        >
          + New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Conversations">
        <p className="px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
          Today
        </p>
        <p className="px-1 py-2 text-sm text-text-secondary">No conversations yet.</p>
      </nav>
      <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3">
        <HermesStatusPill />
        <Link to="/settings" className="text-xs font-medium text-text-secondary hover:text-text-primary">
          Settings
        </Link>
      </div>
    </div>
  );
}
