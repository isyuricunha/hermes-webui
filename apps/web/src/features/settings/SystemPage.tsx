import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  fetchAppStatus,
  fetchLogs,
  fetchUpdateCheck,
  restartGateway,
  runDoctor,
  type LogLines,
} from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

const LOG_FILES = ['agent', 'gateway', 'errors'] as const;
type LogFile = (typeof LOG_FILES)[number];

function LogsViewer() {
  const [file, setFile] = useState<LogFile>('agent');
  const logsQuery = useQuery({
    queryKey: ['logs', file],
    queryFn: () => fetchLogs(file, 100),
    refetchInterval: 10_000,
  });

  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        {LOG_FILES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setFile(candidate)}
            className={[
              'rounded-lg px-2.5 py-1 text-xs',
              file === candidate
                ? 'bg-surface-elevated font-medium text-text-primary'
                : 'text-text-secondary hover:bg-surface-elevated',
            ].join(' ')}
          >
            {candidate}
          </button>
        ))}
      </div>
      {logsQuery.isPending ? (
        <p className="text-xs text-text-secondary">Loading…</p>
      ) : logsQuery.isError ? (
        <SettingsError message={logsQuery.error.message} />
      ) : (
        <pre className="max-h-72 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] leading-relaxed">
          {(logsQuery.data as LogLines).lines.join('')}
        </pre>
      )}
    </div>
  );
}

/**
 * System / Gateway (PRD 28, 29, 37, 38): status, restart with recovery
 * detection, logs, doctor, updates. Small and functional, never the Home.
 */
export function SystemPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['app-status'],
    queryFn: fetchAppStatus,
    refetchInterval: 5_000,
  });
  const updateQuery = useQuery({ queryKey: ['update-check'], queryFn: fetchUpdateCheck });
  const doctor = useMutation({ mutationFn: runDoctor });

  const [phase, setPhase] = useState<'idle' | 'restarting' | 'back'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showCommits, setShowCommits] = useState(false);

  const hermes = statusQuery.data?.hermes;

  /**
   * Restart flow (PRD 29.2/29.4): confirm -> call restart -> poll status
   * until Hermes answers again -> report. The WebUI itself stays up.
   */
  const restart = useMutation({
    mutationFn: restartGateway,
    onMutate: () => {
      setError(null);
      setPhase('restarting');
    },
    onSuccess: () => {
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        void fetchAppStatus()
          .then((status) => {
            if (status.hermes.state === 'connected') {
              setPhase('back');
              void queryClient.invalidateQueries();
            } else if (attempts < 30) {
              setTimeout(poll, 3_000);
            } else {
              setPhase('idle');
              setError('Hermes did not come back within 90s. Check the logs.');
            }
          })
          .catch(() => {
            if (attempts < 30) {
              setTimeout(poll, 3_000);
            } else {
              setPhase('idle');
              setError('Hermes did not come back within 90s. Check the logs.');
            }
          });
      };
      setTimeout(poll, 4_000);
    },
    onError: (restartError) => {
      setPhase('idle');
      setError(restartError instanceof Error ? restartError.message : 'Restart failed.');
    },
  });

  const hermesStateLabel =
    phase === 'restarting'
      ? 'Restarting…'
      : phase === 'back'
        ? 'Back online after restart'
        : hermes?.state === 'connected'
          ? `Running · ${hermes.version}`
          : hermes?.state === 'degraded'
            ? 'Degraded (auth failed)'
            : hermes?.state === 'offline'
              ? 'Offline'
              : '…';

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
            <dd className={phase === 'restarting' ? 'text-warning' : ''}>{hermesStateLabel}</dd>
          </div>
        </dl>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={phase === 'restarting'}
            onClick={() => {
              if (
                window.confirm('Restart Hermes now? Active runs on any channel will be interrupted.')
              ) {
                restart.mutate();
              }
            }}
            className="rounded-xl border border-warning px-4 py-2 text-sm font-medium text-warning hover:bg-surface disabled:opacity-40"
          >
            Restart Hermes
          </button>
          {error !== null ? <span className="text-xs text-danger">{error}</span> : null}
          {phase === 'back' ? (
            <span className="text-xs text-success">Hermes restarted successfully.</span>
          ) : null}
        </div>
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Logs
      </p>
      <LogsViewer />

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
        <div className="text-sm">
          <p>
            Current: {updateQuery.data.current_version ?? '…'}
            {updateQuery.data.update_available ? ' · update available' : ' · up to date'}
          </p>
          {updateQuery.data.update_available ? (
            <>
              <button
                type="button"
                onClick={() => setShowCommits((value) => !value)}
                className="mt-2 rounded-xl border border-border-subtle px-4 py-2 text-sm hover:bg-surface-elevated"
              >
                Review update
              </button>
              <p className="mt-2 text-xs text-text-secondary">
                Applying updates from the WebUI is disabled on this host: the Hermes install
                carries custom patches and must be updated through its own flow.
              </p>
              {showCommits ? (
                <details
                  className="mt-3 rounded-lg border border-border-subtle bg-surface-elevated p-3 text-xs"
                  open
                >
                  <summary className="cursor-pointer select-none font-medium">Incoming commits</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono">
                    {JSON.stringify(updateQuery.data, null, 2).slice(0, 4000)}
                  </pre>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </SettingsPage>
  );
}