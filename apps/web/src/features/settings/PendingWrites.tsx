import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Inbox, ShieldCheck, X } from 'lucide-react';
import {
  fetchPendingWrites,
  pendingWritesKey,
  resolvePendingWrite,
  setWriteApproval,
  type ApprovalSubsystem,
  type PendingOperation,
  type PendingWrite,
} from '../../lib/writeApprovals';
import { relativeTime } from '../../lib/format';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, ErrorNote, SkeletonRows, Switch } from '../../components/ui';

const ACTION_LABEL: Record<string, string> = {
  add: 'settings.pending.actionAdd',
  replace: 'settings.pending.actionReplace',
  remove: 'settings.pending.actionRemove',
  batch: 'settings.pending.actionBatch',
};
const TARGET_LABEL: Record<string, string> = {
  memory: 'settings.pending.targetMemory',
  user: 'settings.pending.targetUser',
};

function useResolve(subsystem: ApprovalSubsystem) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      resolvePendingWrite(subsystem, id, action),
    onSuccess: (result) => {
      toast(
        result.message.split('\n')[0] ?? t('settings.pending.done'),
        result.ok ? 'success' : 'error',
        { durationMs: result.ok ? 4000 : 8000 },
      );
      void queryClient.invalidateQueries({ queryKey: pendingWritesKey(subsystem) });
      if (subsystem === 'memory') void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
    onError: (error) => toastError(error),
  });
}

function Operation({ op }: { op: PendingOperation }) {
  const { t } = useTranslation();
  const target =
    op.target !== null
      ? TARGET_LABEL[op.target] !== undefined
        ? t(TARGET_LABEL[op.target]!)
        : op.target
      : null;
  return (
    <div className="space-y-1.5">
      {target !== null ? (
        <p className="text-[11px] text-text-tertiary uppercase">{target}</p>
      ) : null}
      {op.matched_entry !== null && op.matched_entry !== '' ? (
        <div>
          <p className="mb-1 text-[11px] text-text-tertiary">
            {op.action === 'remove'
              ? t('settings.pending.removesEntry')
              : t('settings.pending.overwritesEntry')}
          </p>
          <p className="rounded-lg bg-surface-input px-3 py-2 text-[13px] whitespace-pre-wrap break-words text-text-tertiary line-through decoration-text-tertiary/50">
            {op.matched_entry}
          </p>
        </div>
      ) : null}
      {op.content !== null && op.content !== '' ? (
        <p className="border-l-2 border-accent/60 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-text-primary">
          {op.content}
        </p>
      ) : null}
    </div>
  );
}

function PendingItem({
  subsystem,
  item,
  busy,
  onResolve,
}: {
  subsystem: ApprovalSubsystem;
  item: PendingWrite;
  busy: boolean;
  onResolve: (action: 'approve' | 'reject') => void;
}) {
  const { t } = useTranslation();
  const action = item.action ?? 'write';
  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={action === 'remove' || action === 'replace' ? 'warning' : 'accent'}>
          {ACTION_LABEL[action] !== undefined ? t(ACTION_LABEL[action]!) : action}
        </Badge>
        {item.origin === 'background_review' ? (
          <Badge tone="agent">{t('settings.pending.autoReview')}</Badge>
        ) : null}
        <span className="font-mono text-[11px] text-text-tertiary">{item.id}</span>
        <span className="ml-auto text-[11px] text-text-tertiary">
          {relativeTime(item.created_at)}
        </span>
      </div>
      {subsystem === 'memory' && item.operations !== undefined && item.operations.length > 0 ? (
        <div className="space-y-3">
          {item.operations.map((op, index) => (
            <Operation key={index} op={op} />
          ))}
        </div>
      ) : (
        <>
          {item.summary !== null && item.summary !== '' ? (
            <p className="text-[13px] whitespace-pre-wrap break-words text-text-primary">
              {item.summary}
            </p>
          ) : null}
          {item.diff !== undefined && item.diff !== null && item.diff !== '' ? (
            <details className="group">
              <summary className="cursor-pointer text-xs text-text-secondary select-none hover:text-text-primary">
                {t('settings.pending.showDiff')}
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-editor p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre text-text-secondary">
                {item.diff}
              </pre>
            </details>
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve('reject')}
          className="yu-btn yu-btn-ghost h-8 gap-1.5 px-3 text-xs"
        >
          <X className="size-3.5" aria-hidden />
          {t('settings.pending.reject')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve('approve')}
          className="yu-btn yu-btn-primary h-8 gap-1.5 px-3 text-xs"
        >
          <Check className="size-3.5" aria-hidden />
          {t('settings.pending.approve')}
        </button>
      </div>
    </div>
  );
}

/**
 * Writes Hermes staged for approval (`<subsystem>.write_approval` on), with
 * approve/reject per item or all at once, and the gate switch itself.
 */
export function PendingWrites({
  subsystem,
  showGate = true,
}: {
  subsystem: ApprovalSubsystem;
  showGate?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: pendingWritesKey(subsystem),
    queryFn: () => fetchPendingWrites(subsystem),
    refetchInterval: 30_000,
  });
  const resolve = useResolve(subsystem);
  const gate = useMutation({
    mutationFn: (enabled: boolean) => setWriteApproval(subsystem, enabled),
    onSuccess: (_result, enabled) => {
      toast(
        enabled
          ? t('settings.pending.gateOnToast', {
              what:
                subsystem === 'memory'
                  ? t('settings.pending.wordMemory')
                  : t('settings.pending.wordSkill'),
            })
          : t('settings.pending.gateOffToast', {
              what:
                subsystem === 'memory' ? 'MEMORY.md / USER.md' : t('settings.pending.wordSkills'),
            }),
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: pendingWritesKey(subsystem) });
    },
    onError: (error) => toastError(error),
  });
  const noun =
    subsystem === 'memory' ? t('settings.pending.wordMemory') : t('settings.pending.wordSkill');

  if (list.isError)
    return <ErrorNote message={list.error.message} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <SkeletonRows rows={2} />;

  const { enabled, pending } = list.data;
  const resolveAll = async (action: 'approve' | 'reject') => {
    const confirmed = await confirmDialog({
      title:
        action === 'approve'
          ? t('settings.pending.approveAllTitle', { count: pending.length, noun })
          : t('settings.pending.rejectAllTitle', { count: pending.length, noun }),
      description:
        action === 'approve'
          ? t('settings.pending.approveAllDesc')
          : t('settings.pending.rejectAllDesc'),
      confirmLabel:
        action === 'approve' ? t('settings.pending.approveAll') : t('settings.pending.rejectAll'),
      tone: action === 'reject' ? 'danger' : 'default',
    });
    if (confirmed) resolve.mutate({ id: 'all', action });
  };

  return (
    <Card>
      {showGate ? (
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
          <ShieldCheck
            className={['size-4 shrink-0', enabled ? 'text-success' : 'text-text-tertiary'].join(
              ' ',
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">
              {t('settings.pending.gateTitle', {
                what:
                  subsystem === 'memory'
                    ? t('settings.pending.memories')
                    : t('settings.pending.skillChanges'),
              })}
            </p>
            <p className="text-xs text-text-tertiary">
              {enabled
                ? t('settings.pending.gateOn', { noun })
                : t('settings.pending.gateOff', {
                    what:
                      subsystem === 'memory'
                        ? 'MEMORY.md / USER.md'
                        : t('settings.pending.wordSkills'),
                  })}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={gate.isPending}
            onChange={(next) => gate.mutate(next)}
            label={t('settings.pending.gateSwitch', { noun })}
          />
        </div>
      ) : null}
      {pending.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-text-secondary">
          <Inbox className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          {t('settings.pending.nothingWaiting')}
        </div>
      ) : (
        <>
          {pending.length > 1 ? (
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
              <span className="flex-1 text-xs text-text-secondary">
                {t('settings.pending.waitingCount', { count: pending.length })}
              </span>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => void resolveAll('reject')}
                className="yu-btn yu-btn-ghost h-7 px-2.5 text-xs"
              >
                {t('settings.pending.rejectAll')}
              </button>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => void resolveAll('approve')}
                className="yu-btn yu-btn-tonal h-7 px-2.5 text-xs"
              >
                {t('settings.pending.approveAll')}
              </button>
            </div>
          ) : null}
          <div className="divide-y divide-border-subtle">
            {pending.map((item) => (
              <PendingItem
                key={item.id}
                subsystem={subsystem}
                item={item}
                busy={resolve.isPending}
                onResolve={(action) => resolve.mutate({ id: item.id, action })}
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** Inline approve/reject for a tool card whose write was staged. */
export function StagedWriteActions({
  subsystem,
  id,
}: {
  subsystem: ApprovalSubsystem;
  id: string;
}) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: pendingWritesKey(subsystem),
    queryFn: () => fetchPendingWrites(subsystem),
    staleTime: 10_000,
  });
  const resolve = useResolve(subsystem);
  if (list.data === undefined) return null;
  const waiting = list.data.pending.some((item) => item.id === id);
  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
      <ShieldCheck
        className={['size-3.5 shrink-0', waiting ? 'text-warning' : 'text-text-tertiary'].join(' ')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 text-xs text-text-secondary">
        {waiting ? t('settings.pending.awaiting') : t('settings.pending.noLongerPending')}
      </span>
      {waiting ? (
        <>
          <button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id, action: 'reject' })}
            className="yu-btn yu-btn-ghost h-7 px-2.5 text-xs"
          >
            {t('settings.pending.reject')}
          </button>
          <button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id, action: 'approve' })}
            className="yu-btn yu-btn-primary h-7 px-2.5 text-xs"
          >
            {t('settings.pending.approve')}
          </button>
        </>
      ) : null}
    </div>
  );
}
