import { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { resolveApproval } from '../../lib/api';
import type { TranscriptApproval } from './transcript';

const APPROVAL_LABELS: Record<string, string> = {
  once: 'chat.approval.allowOnce',
  session: 'chat.approval.allowSession',
  always: 'chat.approval.alwaysAllow',
  deny: 'chat.approval.deny',
};

export function ApprovalCard({
  approval,
  runId,
  onResolved,
}: {
  approval: TranscriptApproval;
  runId: string | null;
  onResolved: (choice: string) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);
  const resolve = (choice: 'once' | 'session' | 'always' | 'deny') => {
    if (runId === null || pending !== null) return;
    setPending(choice);
    void resolveApproval(runId, {
      choice,
      ...(approval.requestId ? { request_id: approval.requestId } : {}),
    })
      .catch(() => undefined)
      .finally(() => onResolved(choice));
  };
  if (approval.resolvedChoice) {
    const denied = approval.resolvedChoice === 'deny';
    const resolvedLabel = APPROVAL_LABELS[approval.resolvedChoice]
      ? t(APPROVAL_LABELS[approval.resolvedChoice] ?? '')
      : approval.resolvedChoice;
    return (
      <div className="my-1.5">
        <span className={['yu-chip', denied ? 'yu-chip-danger' : 'yu-chip-success'].join(' ')}>
          {denied ? <X className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />}
          {denied
            ? t('chat.approval.denied')
            : t('chat.approval.approved', { choice: resolvedLabel })}
        </span>
      </div>
    );
  }
  const choices = (approval.choices.length > 0 ? approval.choices : ['once', 'deny']).filter(
    (choice): choice is 'once' | 'session' | 'always' | 'deny' => choice in APPROVAL_LABELS,
  );
  const allow = choices.filter((choice) => choice !== 'deny');
  return (
    <div
      className="yu-sheen my-2 rounded-2xl p-4"
      role="group"
      aria-label={t('chat.approval.required')}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="yu-chip-accent flex size-7 items-center justify-center rounded-lg"
          aria-hidden
        >
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t('chat.approval.wantsToRun')}</p>
          <p className="text-xs text-text-tertiary">
            {approval.tool !== undefined ? `${approval.tool} · ` : ''}
            {t('chat.approval.needsApproval')}
          </p>
        </div>
      </div>
      {approval.command ? (
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border-subtle bg-surface-editor px-3.5 py-2.5 font-mono text-xs leading-relaxed text-text-primary">
          {approval.command}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {allow.map((choice, index) => (
          <button
            key={choice}
            type="button"
            disabled={pending !== null}
            onClick={() => resolve(choice)}
            className={[
              'yu-btn h-9 px-3.5 text-[13px]',
              index === 0 ? 'yu-btn-primary' : 'yu-btn-secondary',
            ].join(' ')}
          >
            {t(APPROVAL_LABELS[choice] ?? '')}
          </button>
        ))}
        {choices.includes('deny') ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => resolve('deny')}
            className="yu-btn yu-btn-danger h-9 px-3.5 text-[13px]"
          >
            {t('chat.approval.deny')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
