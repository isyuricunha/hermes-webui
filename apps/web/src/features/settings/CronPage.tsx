import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Clock, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  deleteCronJob,
  fetchCronJobs,
  pauseCronJob,
  resumeCronJob,
  runCronJob,
  type CronJob,
} from '../../lib/api';
import { createCronJob, fetchCronRuns, fetchCronTargets, updateCronJob, type CronJobInput } from '../../lib/hx';
import { compactNumber, relativeTime } from '../../lib/format';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Menu, Sheet, SkeletonRows, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

type Action = 'run' | 'pause' | 'resume' | 'delete' | 'edit';

const SCHEDULE_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 30 min', value: 'every 30m' },
  { label: 'Hourly', value: 'every 1h' },
  { label: 'Daily 09:00', value: '0 9 * * *' },
  { label: 'Weekdays 09:00', value: '0 9 * * 1-5' },
  { label: 'Mondays 08:00', value: '0 8 * * 1' },
];

function scheduleOf(job: CronJob): string {
  return job.schedule?.expr ?? job.schedule_display ?? job.schedule?.display ?? '';
}

/** Create or edit a job: name, schedule (cron or "every 30m"), prompt, delivery, skills. */
function CronEditor({ job, onClose }: { job: CronJob | 'new'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = job === 'new' ? null : job;
  const targets = useQuery({ queryKey: ['cron-targets'], queryFn: fetchCronTargets, staleTime: 60_000 });
  const [form, setForm] = useState<CronJobInput>({
    name: existing?.name ?? '',
    schedule: existing !== null ? scheduleOf(existing) : '0 9 * * *',
    prompt: existing?.prompt ?? '',
    deliver: existing?.deliver ?? 'local',
    skills: existing?.skills ?? [],
  });
  const [skillsText, setSkillsText] = useState((existing?.skills ?? []).join(', '));
  const set = (patch: Partial<CronJobInput>) => setForm((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const skills = skillsText.split(',').map((item) => item.trim()).filter((item) => item !== '');
      const input = { ...form, name: form.name.trim(), schedule: form.schedule.trim(), skills: skills.length > 0 ? skills : null };
      return existing === null ? createCronJob(input) : updateCronJob(existing.id, input);
    },
    onSuccess: () => {
      toast(existing === null ? 'Job created.' : 'Job updated.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      onClose();
    },
    onError: (error) => toastError(error),
  });
  const valid = form.name.trim() !== '' && form.schedule.trim() !== '' && form.prompt.trim() !== '';
  const deliverOptions = targets.data?.targets ?? [{ id: 'local', name: 'Local (save only)', home_target_set: true }];

  return (
    <Sheet open onClose={onClose} title={existing === null ? 'New cron job' : `Edit ${existing.name}`} subtitle="Hermes runs it on its own, on schedule">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-secondary">Name</span>
          <input value={form.name} onChange={(event) => set({ name: event.target.value })} className="yu-input h-10 w-full px-3 text-sm" placeholder="Backup check" />
        </label>
        <div>
          <span className="mb-1.5 block text-xs text-text-secondary">Schedule</span>
          <input
            value={form.schedule}
            onChange={(event) => set({ schedule: event.target.value })}
            aria-label="Schedule"
            className="yu-input h-10 w-full px-3 font-mono text-sm"
            placeholder="0 9 * * *  or  every 30m"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SCHEDULE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => set({ schedule: preset.value })}
                className={[
                  'h-7 rounded-lg px-2.5 text-xs transition-colors',
                  form.schedule === preset.value ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)]' : 'text-text-secondary hover:bg-surface-input',
                ].join(' ')}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-text-tertiary">Cron expression (server time) or an interval like “every 2h”.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-secondary">What Hermes should do</span>
          <textarea
            value={form.prompt}
            onChange={(event) => set({ prompt: event.target.value })}
            className="yu-input min-h-32 w-full resize-y px-3 py-2.5 text-sm leading-relaxed"
            placeholder="Check yesterday's backups on my database server and tell me if anything failed."
          />
        </label>
        <div>
          <span className="mb-1.5 block text-xs text-text-secondary">Deliver the result to</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Deliver to">
            {deliverOptions.map((target) => (
              <button
                key={target.id}
                type="button"
                role="radio"
                aria-checked={form.deliver === target.id}
                onClick={() => set({ deliver: target.id })}
                title={target.home_target_set ? undefined : 'No home channel set for this platform yet'}
                className={[
                  'h-8 rounded-xl px-3 text-[13px] transition-colors',
                  form.deliver === target.id
                    ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)] ring-1 ring-accent/50'
                    : 'text-text-secondary hover:bg-surface-input',
                ].join(' ')}
              >
                {target.name}
                {!target.home_target_set ? ' (no home)' : ''}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-secondary">Skills to load (optional, comma separated)</span>
          <input value={skillsText} onChange={(event) => setSkillsText(event.target.value)} className="yu-input h-10 w-full px-3 font-mono text-[13px]" placeholder="backup-check, ssh-hosts" />
        </label>
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
          <button type="button" onClick={onClose} className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]">
            Cancel
          </button>
          <button type="submit" disabled={!valid || save.isPending} className="yu-btn yu-btn-primary h-9 px-4 text-[13px]">
            {save.isPending ? 'Saving…' : existing === null ? 'Create job' : 'Save changes'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

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
            { label: 'Edit', icon: <Pencil />, onSelect: () => onAct('edit') },
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
  const [editing, setEditing] = useState<CronJob | 'new' | null>(null);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => {
      if (action === 'run') return runCronJob(id);
      if (action === 'pause') return pauseCronJob(id);
      if (action === 'resume') return resumeCronJob(id);
      if (action === 'delete') return deleteCronJob(id);
      return Promise.resolve(null);
    },
    onSuccess: (_data, variables) => {
      const label = { run: 'Job started.', pause: 'Job paused.', resume: 'Job resumed.', delete: 'Job deleted.', edit: '' }[variables.action];
      toast(label, 'success');
      void queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['cron-runs', variables.id] });
    },
    onError: (error) => toastError(error),
  });

  const onAct = async (job: CronJob, action: Action) => {
    if (action === 'edit') {
      setEditing(job);
      return;
    }
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
          ? `${jobs.length} scheduled job${jobs.length === 1 ? '' : 's'}. Create them here or just ask Hermes in chat.`
          : 'Scheduled tasks Hermes runs on its own.'
      }
      actions={
        <button type="button" onClick={() => setEditing('new')} className="yu-btn yu-btn-tonal h-9 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" aria-hidden /> New job
        </button>
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
      {editing !== null ? <CronEditor key={editing === 'new' ? 'new' : editing.id} job={editing} onClose={() => setEditing(null)} /> : null}
    </SettingsPage>
  );
}
