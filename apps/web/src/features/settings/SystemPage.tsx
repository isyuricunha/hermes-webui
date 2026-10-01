import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, RotateCw, Stethoscope } from 'lucide-react';
import { fetchAppStatus, fetchUpdateCheck, restartGateway, runDoctor } from '../../lib/api';
import { fetchHermesStatus, fetchSystemStats, startGateway } from '../../lib/hx';
import { bytes, duration, relativeTime } from '../../lib/format';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';
import { Badge, Card, ErrorNote, Section, SkeletonRows, Stat, StatusDot } from '../../components/ui';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** Usage meter: fill carries severity, the track is a lighter step. */
function Meter({ label, percent, detail }: { label: string; percent: number | undefined; detail: string }) {
  const value = Math.max(0, Math.min(100, percent ?? 0));
  const tone = value >= 90 ? 'bg-danger' : value >= 75 ? 'bg-warning' : 'bg-chart';
  return (
    <div className="yu-card rounded-2xl px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-text-tertiary">{label}</p>
        <p className="text-[15px] text-text-primary">{percent === undefined ? '—' : `${Math.round(value)}%`}</p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <div className={['h-full rounded-full transition-[width] duration-500', tone].join(' ')} style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1.5 truncate font-mono text-[11px] text-text-tertiary">{detail}</p>
    </div>
  );
}

const PLATFORM_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  connected: 'success',
  running: 'success',
  ready: 'success',
  connecting: 'warning',
  starting: 'warning',
  error: 'danger',
  failed: 'danger',
};

/**
 * System (PRD 28, 29, 37, 38): gateway and host health, restart with
 * recovery detection, doctor and updates.
 */
export function SystemPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ['app-status'], queryFn: fetchAppStatus, refetchInterval: 5_000 });
  const hermesStatus = useQuery({ queryKey: ['hermes-status'], queryFn: fetchHermesStatus, refetchInterval: 10_000 });
  const stats = useQuery({ queryKey: ['system-stats'], queryFn: fetchSystemStats, refetchInterval: 10_000 });
  const updateQuery = useQuery({ queryKey: ['update-check'], queryFn: fetchUpdateCheck });
  const doctor = useMutation({ mutationFn: runDoctor });

  const [phase, setPhase] = useState<'idle' | 'restarting' | 'back'>('idle');
  const [error, setError] = useState<string | null>(null);

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
      const giveUp = () => {
        setPhase('idle');
        setError('Hermes did not come back within 90s. Check the logs.');
      };
      const poll = () => {
        attempts += 1;
        void fetchAppStatus()
          .then((status) => {
            if (status.hermes.state === 'connected') {
              setPhase('back');
              toast('Hermes is back online.', 'success');
              void queryClient.invalidateQueries();
            } else if (attempts < 30) {
              setTimeout(poll, 3_000);
            } else {
              giveUp();
            }
          })
          .catch(() => (attempts < 30 ? setTimeout(poll, 3_000) : giveUp()));
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
  const stateTone =
    phase === 'restarting' ? 'warning' : hermes?.state === 'connected' ? 'success' : hermes?.state === 'offline' ? 'danger' : 'warning';

  const platforms = Object.entries(hermesStatus.data?.gateway_platforms ?? {});
  const s = stats.data;

  return (
    <SettingsPage
      title="System"
      description="Health of Hermes and the machine it runs on."
      wide
      actions={
        <button
          type="button"
          disabled={phase === 'restarting'}
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Restart Hermes now?',
              description: 'Active runs on every channel (Telegram included) are interrupted. The WebUI stays up and reconnects.',
              confirmLabel: 'Restart',
              tone: 'danger',
            });
            if (ok) restart.mutate();
          }}
          className="yu-btn yu-btn-secondary h-9 px-3.5 text-[13px]"
        >
          <RotateCw className={['size-3.5', phase === 'restarting' ? 'animate-spin' : ''].join(' ')} aria-hidden />
          Restart Hermes
        </button>
      }
    >
      {error !== null ? (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      ) : null}

      <Card className="mb-7 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <span className="flex items-center gap-2.5">
          <StatusDot tone={stateTone} />
          <span className="text-[15px] text-text-primary">{hermesStateLabel}</span>
        </span>
        {hermes?.state === 'offline' && phase !== 'restarting' ? (
          <button
            type="button"
            onClick={() =>
              void startGateway().then(
                () => {
                  toast('Starting Hermes…', 'success');
                  setTimeout(() => void queryClient.invalidateQueries(), 5_000);
                },
                (startError: unknown) => setError(startError instanceof Error ? startError.message : 'Could not start Hermes.'),
              )
            }
            className="yu-btn yu-btn-primary h-8 rounded-lg px-3 text-xs"
          >
            Start Hermes
          </button>
        ) : null}
        <span className="font-mono text-[11px] text-text-tertiary">WebUI {statusQuery.data?.version ?? '…'}</span>
        {hermesStatus.data !== undefined ? (
          <>
            {hermesStatus.data.release_date ? (
              <span className="font-mono text-[11px] text-text-tertiary">released {hermesStatus.data.release_date}</span>
            ) : null}
            {hermesStatus.data.gateway_pid ? (
              <span className="font-mono text-[11px] text-text-tertiary">pid {hermesStatus.data.gateway_pid}</span>
            ) : null}
            {typeof hermesStatus.data.active_sessions === 'number' ? (
              <span className="font-mono text-[11px] text-text-tertiary">{hermesStatus.data.active_sessions} active sessions</span>
            ) : null}
            {hermesStatus.data.config_version !== undefined &&
            hermesStatus.data.latest_config_version !== undefined &&
            hermesStatus.data.config_version < hermesStatus.data.latest_config_version ? (
              <Badge tone="warning">config migration pending</Badge>
            ) : null}
          </>
        ) : null}
      </Card>

      <Section title="Host" description={s !== undefined ? `${s.hostname} · ${s.os} ${s.arch} · Python ${s.python_version}` : undefined}>
        {stats.isError ? (
          <ErrorNote message={stats.error.message} />
        ) : s === undefined ? (
          <SkeletonRows rows={1} />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Meter
              label="CPU"
              percent={s.cpu_percent}
              detail={`${s.cpu_count ?? '?'} cores · load ${(s.load_avg ?? []).map((value) => value.toFixed(2)).join(' ')}`}
            />
            <Meter
              label="Memory"
              percent={s.memory?.percent}
              detail={s.memory !== undefined ? `${bytes(s.memory.used)} of ${bytes(s.memory.total)}` : '—'}
            />
            <Meter
              label="Disk"
              percent={s.disk?.percent}
              detail={s.disk !== undefined ? `${bytes(s.disk.free)} free of ${bytes(s.disk.total)}` : '—'}
            />
            <Stat
              label="Uptime"
              value={duration(s.uptime_seconds)}
              hint={s.process !== undefined ? `dashboard ${bytes(s.process.rss)} · ${s.process.num_threads} threads` : undefined}
            />
          </div>
        )}
      </Section>

      <Section title="Channels" description="Platforms the gateway is serving.">
        {hermesStatus.isError ? (
          <ErrorNote message={hermesStatus.error.message} />
        ) : hermesStatus.isPending ? (
          <SkeletonRows rows={2} />
        ) : platforms.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">No platform status reported.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-border-subtle">
              {platforms.map(([name, platform]) => (
                <li key={name} className="flex items-center gap-3 px-4 py-3">
                  <StatusDot tone={PLATFORM_TONE[platform.state] ?? 'neutral'} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-text-primary capitalize">{name.replace(/_/g, ' ')}</span>
                    {platform.error_message ? (
                      <span className="block truncate text-xs text-danger">{platform.error_message}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[11px] text-text-tertiary">{platform.state}</span>
                  <span className="hidden font-mono text-[11px] text-text-tertiary sm:inline">{relativeTime(platform.updated_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Link to="/settings/logs" className="yu-link mt-2 inline-flex items-center gap-1 text-xs">
          Open logs <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </Section>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="Diagnostics">
          <Card className="p-4">
            <p className="text-[13px] text-text-secondary">Runs <code className="font-mono text-xs">hermes doctor</code> checks for config, keys and dependencies.</p>
            <button
              type="button"
              onClick={() => doctor.mutate()}
              disabled={doctor.isPending}
              className="yu-btn yu-btn-tonal mt-3 h-9 px-3.5 text-[13px]"
            >
              <Stethoscope className="size-3.5" aria-hidden />
              {doctor.isPending ? 'Running doctor…' : 'Run doctor'}
            </button>
            {doctor.isError ? (
              <div className="mt-3">
                <SettingsError message={doctor.error.message} />
              </div>
            ) : null}
            {doctor.data !== undefined ? (
              <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-surface-editor p-3 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
                {JSON.stringify(doctor.data, null, 2)}
              </pre>
            ) : null}
          </Card>
        </Section>

        <Section title="Updates">
          <Card className="p-4">
            {updateQuery.isPending ? (
              <p className="yu-shimmer text-[13px]">Checking…</p>
            ) : updateQuery.isError ? (
              <SettingsError message={updateQuery.error.message} />
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm text-text-primary">
                  {updateQuery.data.current_version ?? hermesStatus.data?.version ?? 'Unknown version'}
                  {updateQuery.data.update_available ? <Badge tone="accent">update available</Badge> : <Badge tone="success">up to date</Badge>}
                </p>
                {updateQuery.data.update_available ? (
                  <>
                    <p className="mt-2 text-xs text-text-tertiary">
                      Applying updates from the WebUI is disabled: this Hermes install carries local patches and updates through its own flow.
                    </p>
                    {(updateQuery.data.commits?.length ?? 0) > 0 ? (
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer text-text-secondary select-none">
                          What’s incoming ({updateQuery.data.commits!.length} changes)
                        </summary>
                        <ul className="mt-2 max-h-72 divide-y divide-border-subtle overflow-auto rounded-xl bg-surface-editor">
                          {updateQuery.data.commits!.map((commit) => (
                            <li key={commit.sha} className="px-3 py-2">
                              <p className="text-text-primary">{commit.summary}</p>
                              <p className="font-mono text-[10.5px] text-text-tertiary">
                                {commit.sha.slice(0, 8)}
                                {commit.author ? ` · ${commit.author}` : ''}
                                {commit.at ? ` · ${relativeTime(commit.at)}` : ''}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : updateQuery.data.update_command ? (
                      <p className="mt-2 font-mono text-[11px] text-text-tertiary">{updateQuery.data.update_command}</p>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </Card>
        </Section>
      </div>
    </SettingsPage>
  );
}
