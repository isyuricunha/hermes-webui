import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const ACTION_LABEL: Record<string, string> = { add: 'Add', replace: 'Replace', remove: 'Remove', batch: 'Batch' };
const TARGET_LABEL: Record<string, string> = { memory: 'Memory', user: 'User profile' };

function useResolve(subsystem: ApprovalSubsystem) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => resolvePendingWrite(subsystem, id, action),
    onSuccess: (result) => {
      toast(result.message.split('\n')[0] ?? 'Done.', result.ok ? 'success' : 'error', { durationMs: result.ok ? 4000 : 8000 });
      void queryClient.invalidateQueries({ queryKey: pendingWritesKey(subsystem) });
      if (subsystem === 'memory') void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
    onError: (error) => toastError(error),
  });
}

function Operation({ op }: { op: PendingOperation }) {
  const target = op.target !== null ? (TARGET_LABEL[op.target] ?? op.target) : null;
  return (
    <div className="space-y-1.5">
      {target !== null ? <p className="text-[11px] text-text-tertiary uppercase">{target}</p> : null}
      {op.matched_entry !== null && op.matched_entry !== '' ? (
        <div>
          <p className="mb-1 text-[11px] text-text-tertiary">
            {op.action === 'remove' ? 'Removes this entry:' : 'Overwrites this whole entry:'}
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

function PendingItem({ subsystem, item, busy, onResolve }: {
  subsystem: ApprovalSubsystem;
  item: PendingWrite;
  busy: boolean;
  onResolve: (action: 'approve' | 'reject') => void;
}) {
  const action = item.action ?? 'write';
  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={action === 'remove' || action === 'replace' ? 'warning' : 'accent'}>{ACTION_LABEL[action] ?? action}</Badge>
        {item.origin === 'background_review' ? <Badge tone="agent">auto review</Badge> : null}
        <span className="font-mono text-[11px] text-text-tertiary">{item.id}</span>
        <span className="ml-auto text-[11px] text-text-tertiary">{relativeTime(item.created_at)}</span>
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
            <p className="text-[13px] whitespace-pre-wrap break-words text-text-primary">{item.summary}</p>
          ) : null}
          {item.diff !== undefined && item.diff !== null && item.diff !== '' ? (
            <details className="group">
              <summary className="cursor-pointer text-xs text-text-secondary select-none hover:text-text-primary">Show diff</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-editor p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre text-text-secondary">
                {item.diff}
              </pre>
            </details>
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => onResolve('reject')} className="yu-btn yu-btn-ghost h-8 gap-1.5 px-3 text-xs">
          <X className="size-3.5" aria-hidden />
          Reject
        </button>
        <button type="button" disabled={busy} onClick={() => onResolve('approve')} className="yu-btn yu-btn-primary h-8 gap-1.5 px-3 text-xs">
          <Check className="size-3.5" aria-hidden />
          Approve
        </button>
      </div>
    </div>
  );
}

/**
 * Writes Hermes staged for approval (`<subsystem>.write_approval` on), with
 * approve/reject per item or all at once, and the gate switch itself.
 */
export function PendingWrites({ subsystem, showGate = true }: { subsystem: ApprovalSubsystem; showGate?: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: pendingWritesKey(subsystem), queryFn: () => fetchPendingWrites(subsystem), refetchInterval: 30_000 });
  const resolve = useResolve(subsystem);
  const gate = useMutation({
    mutationFn: (enabled: boolean) => setWriteApproval(subsystem, enabled),
    onSuccess: (_result, enabled) => {
      toast(enabled ? `Hermes will ask before saving ${subsystem}.` : `Hermes saves ${subsystem} directly now.`, 'success');
      void queryClient.invalidateQueries({ queryKey: pendingWritesKey(subsystem) });
    },
    onError: (error) => toastError(error),
  });
  const noun = subsystem === 'memory' ? 'memory' : 'skill';

  if (list.isError) return <ErrorNote message={list.error.message} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <SkeletonRows rows={2} />;

  const { enabled, pending } = list.data;
  const resolveAll = async (action: 'approve' | 'reject') => {
    const confirmed = await confirmDialog({
      title: action === 'approve' ? `Approve all ${pending.length} ${noun} writes?` : `Reject all ${pending.length} ${noun} writes?`,
      description: action === 'approve' ? 'Each one is applied exactly as shown.' : 'They are discarded; Hermes will not save them.',
      confirmLabel: action === 'approve' ? 'Approve all' : 'Reject all',
      tone: action === 'reject' ? 'danger' : 'default',
    });
    if (confirmed) resolve.mutate({ id: 'all', action });
  };

  return (
    <Card>
      {showGate ? (
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
          <ShieldCheck className={['size-4 shrink-0', enabled ? 'text-success' : 'text-text-tertiary'].join(' ')} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">Ask before saving {subsystem === 'memory' ? 'memories' : 'skill changes'}</p>
            <p className="text-xs text-text-tertiary">
              {enabled
                ? `Hermes stages every ${noun} write here until you approve it.`
                : `Off: Hermes writes ${subsystem === 'memory' ? 'MEMORY.md / USER.md' : 'skills'} directly.`}
            </p>
          </div>
          <Switch checked={enabled} disabled={gate.isPending} onChange={(next) => gate.mutate(next)} label={`Ask before saving ${noun} writes`} />
        </div>
      ) : null}
      {pending.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-text-secondary">
          <Inbox className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          Nothing waiting for approval.
        </div>
      ) : (
        <>
          {pending.length > 1 ? (
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
              <span className="flex-1 text-xs text-text-secondary">{pending.length} waiting</span>
              <button type="button" disabled={resolve.isPending} onClick={() => void resolveAll('reject')} className="yu-btn yu-btn-ghost h-7 px-2.5 text-xs">
                Reject all
              </button>
              <button type="button" disabled={resolve.isPending} onClick={() => void resolveAll('approve')} className="yu-btn yu-btn-tonal h-7 px-2.5 text-xs">
                Approve all
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
export function StagedWriteActions({ subsystem, id }: { subsystem: ApprovalSubsystem; id: string }) {
  const list = useQuery({ queryKey: pendingWritesKey(subsystem), queryFn: () => fetchPendingWrites(subsystem), staleTime: 10_000 });
  const resolve = useResolve(subsystem);
  if (list.data === undefined) return null;
  const waiting = list.data.pending.some((item) => item.id === id);
  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
      <ShieldCheck className={['size-3.5 shrink-0', waiting ? 'text-warning' : 'text-text-tertiary'].join(' ')} aria-hidden />
      <span className="min-w-0 flex-1 text-xs text-text-secondary">
        {waiting ? 'Waiting for your approval.' : 'No longer pending (approved or rejected).'}
      </span>
      {waiting ? (
        <>
          <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id, action: 'reject' })} className="yu-btn yu-btn-ghost h-7 px-2.5 text-xs">
            Reject
          </button>
          <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id, action: 'approve' })} className="yu-btn yu-btn-primary h-7 px-2.5 text-xs">
            Approve
          </button>
        </>
      ) : null}
    </div>
  );
}
