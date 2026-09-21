/**
 * Settings is its own workspace (PRD 6.2, 19). This placeholder marks the
 * route until Phase 3 delivers the schema-driven workspace.
 */
export function SettingsPlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-text-secondary">
        The settings workspace arrives with Phase 3. Hermes remains the source of truth.
      </p>
    </div>
  );
}
