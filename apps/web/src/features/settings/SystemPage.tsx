import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchAppStatus, fetchUpdateCheck, runDoctor } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** System / Gateway (PRD 28, 37, 38): small, functional, out of the Home. */
export function SystemPage() {
  const statusQuery = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    refetchInterval: 10_000,
  });
  const updateQuery = useQuery({ queryKey: ['update-check'], queryFn: fetchUpdateCheck });
  const doctor = useMutation({ mutationFn: runDoctor });

  const hermes = statusQuery.data?.hermes;

  return (
    <SettingsPage title="System">
      <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-secondary">WebUI</dt>
            <dd>{statusQuery.data?.version ?? '…'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-secondary">Hermes</dt>
            <dd>
              {hermes?.state === 'connected'
                ? `${hermes.version} @ ${hermes.baseUrl}`
                : hermes?.state === 'degraded'
                  ? 'Degraded (auth failed)'
                  : hermes?.state === 'offline'
                    ? 'Offline'
                    : '…'}
            </dd>
          </div>
        </dl>
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Diagnostics
      </p>
      <button
        type="button"
        onClick={() => doctor.mutate()}
        disabled={doctor.isPending}
        className="rounded-xl border border-border-subtle px-4 py-2 text-sm hover:bg-surface-elevated disabled:opacity-40"
      >
        {doctor.isPending ? 'Running doctor…' : 'Run doctor'}
      </button>
      {doctor.isError ? (
        <div className="mt-3">
          <SettingsError message={doctor.error.message} />
        </div>
      ) : null}
      {doctor.data !== undefined ? (
        <details className="mt-3 rounded-lg border border-border-subtle bg-surface-elevated p-3 text-xs">
          <summary className="cursor-pointer select-none font-medium">Doctor result</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(doctor.data, null, 2)}
          </pre>
        </details>
      ) : null}

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Updates
      </p>
      {updateQuery.isPending ? (
        <p className="text-sm text-text-secondary">Checking…</p>
      ) : updateQuery.isError ? (
        <SettingsError message={updateQuery.error.message} />
      ) : (
        <p className="text-sm">
          {updateQuery.data.update_available
            ? `Update available${updateQuery.data.can_apply ? '' : ' (apply externally)'}.`
            : 'Hermes is up to date.'}
        </p>
      )}
      <p className="mt-6 text-xs text-text-secondary">
        Gateway restart, logs and the full update flow arrive with Phase 4; they restart Hermes
        without taking the WebUI down (PRD 29).
      </p>
    </SettingsPage>
  );
}
