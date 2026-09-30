import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Clock, MoreHorizontal, Play, Trash2 } from 'lucide-react';
import {
  deleteCronJob,
  fetchCronJobs,
  pauseCronJob,
  resumeCronJob,
  runCronJob,
  type CronJob,
} from '../../lib/api';
import { fetchCronRuns } from '../../lib/hx';
import { compactNumber, relativeTime } from '../../lib/format';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Menu, SkeletonRows, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

type Action = 'run' | 'pause' | 'resume' | 'delete';

function isPaused(job: CronJob): boolean {
  return job.paused === true || job.enabled === false || job.state === 'paused';
}

function RunHistory({ jobId }: { jobId: string }) {
  const runs = useQuery({ queryKey: ['cron-runs', jobId], queryFn: () => fetchCronRuns(jobId, 10) });
  if (runs.isPending) return <SkeletonRows rows={2} />;
  if (runs.isError) return <ErrorNote message={runs.error.message} />;
  if (runs.data.runs.length === 0) return <p className="text-[13px] text-text-tertiary">No runs recorded yet.</p>;
  return (
    <ul className="space-y-0.5">
      {runs.data.runs.map((run) => (
        <li key={run.id}>
          <Link
            to="/chat/$sessionId"
            params={{ sessionId: run.id }}
            className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-input"
          >
            <span className="mt-1 font-mono text-[11px] whitespace-nowrap text-text-tertiary">{relativeTime(run.started_at)}</span>
            <span className="min-w-0 flex-1 line-clamp-2 text-[13px] text-text-secondary">{run.preview ?? run.title ?? 'Run'}</span>
            {run.input_tokens !== undefined ? (
              <span className="mt-1 hidden font-mono text-[10.5px] text-text-tertiary sm:inline">
                {compactNumber((run.input_tokens ?? 0) + (run.output_tokens ?? 0))} tok
              </span>
            ) : null}
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CronJobCard({ job, onAct, busy }: { job: CronJob; onAct: (action: Action) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const schedule = job.schedule_display ?? job.schedule?.display ?? job.schedule?.expr ?? '';
  const paused = isPaused(job);
  const failed = job.last_status !== undefined && job.last_status !== null && /fail|error/i.test(job.last_status);
  return (
    <Card className={['p-4', paused ? 'opacity-75' : ''].join(' ')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-text-tertiary">
          <Clock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium break-words text-text-primary">
            {job.name}
            {paused ? <Badge>Paused</Badge> : null}
            {failed ? <Badge tone="danger">Last run failed</Badge> : job.last_status ? <Badge tone="success">{job.last_status}</Badge> : null}
            {job.no_agent ? <Badge>script</Badge> : null}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-text-tertiary">
            {schedule !== '' ? <span>{schedule}</span> : null}
            {job.next_run_at && !paused ? <span>next {relativeTime(job.next_run_at)}</span> : null}
            {job.last_run_at ? <span>last {relativeTime(job.last_run_at)}</span> : null}
            {job.deliver ? <span>→ {job.deliver}</span> : null}
          </p>
          {job.prompt ? <p className="mt-1.5 line-clamp-2 text-[13px] text-text-secondary">{job.prompt}</p> : null}
          {job.last_error ? <p className="mt-1.5 line-clamp-2 text-xs text-danger">{job.last_error}</p> : null}
        </div>
        <Switch label={`${job.name} active`} checked={!paused} disabled={busy} onChange={(next) => onAct(next ? 'resume' : 'pause')} />
        <Menu
          label={`Actions for ${job.name}`}
          trigger={<MoreHorizontal className="size-4" aria-hidden />}
          items={[
            { label: 'Run now', icon: <Play />, onSelect: () => onAct('run') },
            { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => onAct('delete') },
          ]}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => onAct('run')} disabled={busy} className="yu-btn yu-btn-tonal h-8 px-3 text-xs">
          <Play className="size-3" aria-hidden />
          Run now
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="yu-btn yu-btn-ghost h-8 px-2.5 text-xs"
        >
          <ChevronRight className={['size-3.5 transition-transform', open ? 'rotate-90' : ''].join(' ')} aria-hidden />
          History
        </button>
      </div>
      {open ? (
        <div className="mt-2 border-t border-border-subtle pt-2">
          <RunHistory jobId={job.id} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Cron / automations (PRD 26): real jobs from the gateway API with schedule,
 * run-now, pause/resume, delete and each job's past runs (which are
 * conversations you can open).
 */
export function CronPage() {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({ queryKey: ['cron-jobs'], queryFn: fetchCronJobs });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => {
      if (action === 'run') return runCronJob(id);
      if (action === 'pause') return pauseCronJob(id);
      if (action === 'resume') return resumeCronJob(id);
      return deleteCronJob(id);
    },
    onSuccess: (_data, variables) => {
      const label = { run: 'Job started.', pause: 'Job paused.', resume: 'Job resumed.', delete: 'Job deleted.' }[variables.action];
      toast(label, 'success');
      void queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['cron-runs', variables.id] });
    },
    onError: (error) => toastError(error),
  });

  const onAct = async (job: CronJob, action: Action) => {
    if (action === 'delete') {
      const ok = await confirmDialog({
        title: `Delete “${job.name}”?`,
        description: 'The schedule is removed from Hermes. Past runs stay in your conversations.',
        confirmLabel: 'Delete job',
        tone: 'danger',
      });
      if (!ok) return;
    }
    act.mutate({ id: job.id, action });
  };

  const jobs = jobsQuery.data?.jobs ?? [];
  return (
    <SettingsPage
      title="Cron"
      description={
        jobsQuery.data !== undefined
          ? `${jobs.length} scheduled job${jobs.length === 1 ? '' : 's'}. Create new ones by asking Hermes in chat.`
          : 'Scheduled tasks Hermes runs on its own.'
      }
    >
      {jobsQuery.isError ? (
        <ErrorNote message={jobsQuery.error.message} onRetry={() => void jobsQuery.refetch()} />
      ) : jobsQuery.isPending ? (
        <SkeletonRows rows={3} />
      ) : jobs.length === 0 ? (
        <EmptyNote icon={<Clock className="size-6" />} title="No jobs yet">
          Ask Hermes something like “every day at 9, check the backups and tell me on Telegram”.
        </EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((job) => (
            <CronJobCard
              key={job.id}
              job={job}
              busy={act.isPending && act.variables?.id === job.id}
              onAct={(action) => void onAct(job, action)}
            />
          ))}
        </div>
      )}
    </SettingsPage>
  );
}
