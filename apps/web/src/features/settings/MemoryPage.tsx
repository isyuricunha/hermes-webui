import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, CheckCircle2, ChevronRight, CircleDashed, CircleSlash, Play } from 'lucide-react';
import { fetchActiveProfile, fetchCurator, fetchMemory, runCurator, setCuratorPaused, type MemoryProviderInfo } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { MemoryProviderSheet } from './MemoryProviderSheet';
import { relativeTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, ErrorNote, Section, SkeletonRows, Stat, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';
import { PendingWrites } from './PendingWrites';
import { MemoryFiles } from './MemoryFiles';

const STATUS: Record<MemoryProviderInfo['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  ready: { label: 'Ready', tone: 'success' },
  needs_config: { label: 'Needs setup', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
  missing: { label: 'Not installed', tone: 'neutral' },
};

/** Memory: which provider remembers things, and the skill curator. */
export function MemoryPage() {
  const queryClient = useQueryClient();
  const memory = useQuery({ queryKey: ['memory'], queryFn: fetchMemory });
  const curator = useQuery({ queryKey: ['curator'], queryFn: fetchCurator });
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const activeProfile = useQuery({ queryKey: ['active-profile'], queryFn: fetchActiveProfile });
  const runNow = useMutation({
    mutationFn: () => runCurator(activeProfile.data?.current ?? activeProfile.data?.active ?? 'default'),
    onSuccess: () => {
      toast('Curator started. It works in the background; results show in Skills and Memory.', 'success');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['curator'] }), 5_000);
    },
    onError: (error) => toastError(error),
  });
  const pause = useMutation({
    mutationFn: setCuratorPaused,
    onSuccess: (result) => {
      toast(result.paused ? 'Curator paused.' : 'Curator resumed.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['curator'] });
    },
    onError: (error) => toastError(error),
  });

  return (
    <SettingsPage
      title="Memory"
      description="How Hermes remembers you across Telegram, this app and every other channel."
    >
      <Section
        title="Waiting for approval"
        description="Memory changes Hermes staged for you to review (the /memory command)."
      >
        <PendingWrites subsystem="memory" />
      </Section>
      <Section
        title="What Hermes remembers"
        description="The built-in memory files, entry by entry. Edits apply to new conversations; a running one picks them up after /new or /reset."
      >
        <MemoryFiles />
      </Section>
      {memory.isError ? (
        <ErrorNote message={memory.error.message} onRetry={() => void memory.refetch()} />
      ) : memory.isPending ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <div className="mb-7 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Stat label="Active provider" value={memory.data.active || 'builtin'} tone="agent" />
            <Stat label="MEMORY.md entries" value={memory.data.builtin_files.memory} hint="Facts Hermes keeps" />
            <Stat label="USER.md entries" value={memory.data.builtin_files.user} hint="What Hermes knows about you" />
          </div>
          <Section title="Providers">
            <Card>
              <ul className="divide-y divide-border-subtle">
                {memory.data.providers.map((provider) => {
                  const status = STATUS[provider.status] ?? STATUS.unavailable;
                  const active = provider.name === memory.data.active;
                  return (
                    <li key={provider.name}>
                      <button
                        type="button"
                        onClick={() => setOpenProvider(provider.name)}
                        className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-hover"
                      >
                      <span className="mt-0.5 text-text-tertiary">
                        {provider.status === 'ready' ? (
                          <CheckCircle2 className="size-4 text-success" aria-hidden />
                        ) : provider.status === 'needs_config' ? (
                          <CircleDashed className="size-4 text-warning" aria-hidden />
                        ) : (
                          <CircleSlash className="size-4" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                          {provider.name}
                          {active ? <Badge tone="agent">Active</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-[13px] text-text-secondary">{provider.description}</p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <p className="mt-2 text-xs text-text-tertiary">
              The built-in memory files always work; a provider adds its own long-term store on top. Open one to set it up or switch to it.
            </p>
          </Section>
        </>
      )}

      <Section title="Curator" description="Tidies stale skills and memories while Hermes is idle.">
        {curator.isError ? (
          <ErrorNote message={curator.error.message} />
        ) : curator.isPending ? (
          <SkeletonRows rows={1} />
        ) : (
          <Card className="flex items-center gap-4 px-4 py-3.5">
            <Brain className="size-5 shrink-0 text-agent-soft" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary">
                {curator.data.enabled ? (curator.data.paused ? 'Paused' : 'Running') : 'Disabled in config'}
              </p>
              <p className="text-xs text-text-tertiary">
                {curator.data.interval_hours !== null ? `Every ${curator.data.interval_hours}h` : 'No schedule'}
                {curator.data.last_run_at !== null ? ` · last run ${relativeTime(curator.data.last_run_at)}` : ''}
                {curator.data.archive_after_days !== null ? ` · archives after ${curator.data.archive_after_days} days` : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={runNow.isPending || !curator.data.enabled}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Run the curator now?',
                  description: 'It reviews skills and memories right away instead of waiting for Hermes to be idle, and may archive stale ones.',
                  confirmLabel: 'Run now',
                });
                if (ok) runNow.mutate();
              }}
              className="yu-btn yu-btn-tonal h-8 gap-1.5 rounded-lg px-3 text-xs"
            >
              <Play className="size-3.5" aria-hidden />
              {runNow.isPending ? 'Starting…' : 'Run now'}
            </button>
            <Switch
              label="Curator running"
              checked={curator.data.enabled && !curator.data.paused}
              disabled={!curator.data.enabled || pause.isPending}
              onChange={(next) => pause.mutate(!next)}
            />
          </Card>
        )}
      </Section>
      {openProvider !== null && memory.data !== undefined
        ? (() => {
            const provider = memory.data.providers.find((p) => p.name === openProvider);
            return provider === undefined ? null : (
              <MemoryProviderSheet provider={provider} active={provider.name === memory.data.active} onClose={() => setOpenProvider(null)} />
            );
          })()
        : null}
    </SettingsPage>
  );
}
