import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  deleteCronJob,
  fetchCronJobs,
  pauseCronJob,
  resumeCronJob,
  runCronJob,
  type CronJob,
} from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/**
 * Cron / automations (PRD 26): real jobs from the gateway API with schedule,
 * run-now, pause/resume and delete. Editing walks the same payload contract
 * the gateway validates.
 */
export function CronPage() {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({ queryKey: ['cron-jobs'], queryFn: fetchCronJobs });
  const [message, setMessage] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'run' | 'pause' | 'resume' | 'delete' }) => {
      if (action === 'run') return runCronJob(id);
      if (action === 'pause') return pauseCronJob(id);
      if (action === 'resume') return resumeCronJob(id);
      return deleteCronJob(id);
    },
    onSuccess: (_data, variables) => {
      setMessage(`${variables.action}: ok`);
      void queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
    },
    onError: (error) => setMessage(error.message),
  });

  if (jobsQuery.isPending) {
    return (
      <SettingsPage title="Cron">
        <p className="text-sm text-text-secondary">Loading jobs…</p>
      </SettingsPage>
    );
  }
  if (jobsQuery.isError) {
    return (
      <SettingsPage title="Cron">
        <SettingsError message={jobsQuery.error.message} />
      </SettingsPage>
    );
  }

  const jobs = jobsQuery.data.jobs ?? [];

  return (
    <SettingsPage title="Cron">
      {message ? <p className="mb-3 text-xs text-text-secondary">{message}</p> : null}
      {jobs.length === 0 ? (
        <p className="text-sm text-text-secondary">No jobs configured.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <CronJobRow key={job.id} job={job} onAct={(action) => act.mutate({ id: job.id, action })} />
          ))}
        </ul>
      )}
    </SettingsPage>
  );
}

function CronJobRow({ job, onAct }: { job: CronJob; onAct: (action: 'run' | 'pause' | 'resume' | 'delete') => void }) {
  const schedule = job.schedule_display ?? job.schedule?.display ?? job.schedule?.expr ?? '';
  return (
    <li className="rounded-lg border border-border-subtle bg-surface-elevated p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{job.name}</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {schedule}
            {job.paused ? ' · paused' : ''}
          </p>
          {job.prompt ? (
            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{job.prompt}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => onAct('run')}
            className="yu-btn yu-btn-primary px-2.5 py-1.5 text-xs"
          >
            Run now
          </button>
          <button
            type="button"
            onClick={() => onAct(job.paused ? 'resume' : 'pause')}
            className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs"
          >
            {job.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete job "${job.name}"?`)) onAct('delete');
            }}
            aria-label={`Delete ${job.name}`}
            className="rounded-lg border border-danger px-2.5 py-1.5 text-xs text-danger"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
