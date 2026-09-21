/**
 * New chat state (PRD 10.1): when there is no active session, the home route
 * shows the composer-ready empty state, never an administrative dashboard.
 */
export function ChatEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">New chat</h1>
      <p className="max-w-md text-center text-sm text-text-secondary">
        Talk to Hermes. Sessions, tools and settings stay one click away.
      </p>
      <div
        className="flex w-full max-w-xl items-center rounded-xl border border-border-subtle bg-surface-elevated px-4 py-3 text-sm text-text-secondary"
        aria-hidden
      >
        Message Hermes…
      </div>
    </div>
  );
}
