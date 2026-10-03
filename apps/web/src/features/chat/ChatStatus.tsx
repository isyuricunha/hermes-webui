import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { fetchSettingsConfig, putSettingsConfig, type SessionContextInfo } from '../../lib/api';
import { compactNumber } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Menu } from '../../components/ui';

/**
 * Composer status: the reasoning effort Hermes runs with (click to change)
 * and how full the conversation's context window is.
 */

export const REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;

const LEVEL_HINT: Record<string, string> = {
  none: 'chat.status.level.none',
  minimal: 'chat.status.level.minimal',
  low: 'chat.status.level.low',
  medium: 'chat.status.level.medium',
  high: 'chat.status.level.high',
  xhigh: 'chat.status.level.xhigh',
  max: 'chat.status.level.max',
  ultra: 'chat.status.level.ultra',
};

export function reasoningOf(config: unknown): string | null {
  const agent = (config as { agent?: { reasoning_effort?: unknown } } | undefined)?.agent;
  const value = agent?.reasoning_effort;
  return typeof value === 'string' && value !== '' ? value.toLowerCase() : null;
}

export const configQueryKey = ['settings-config'];

export function useReasoningEffort() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const config = useQuery({
    queryKey: configQueryKey,
    queryFn: fetchSettingsConfig,
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: (level: string) => putSettingsConfig({ agent: { reasoning_effort: level } }),
    onSuccess: (_data, level) => {
      void queryClient.invalidateQueries({ queryKey: configQueryKey });
      toast(t('chat.status.effortSaved', { level }), 'success');
    },
    onError: (error) => toastError(error, t('chat.status.effortFail')),
  });
  return {
    level: reasoningOf(config.data),
    loading: config.isPending,
    set: (level: string) => mutation.mutate(level),
  };
}

export function ReasoningChip() {
  const { t } = useTranslation();
  const { level, loading, set } = useReasoningEffort();
  if (loading) return null;
  const current = level ?? 'default';
  return (
    <Menu
      label={t('chat.status.effortLabel')}
      align="start"
      above
      tip={t('chat.status.effortTip', { current })}
      triggerClassName="yu-btn yu-btn-ghost h-8 shrink-0 gap-1 rounded-lg px-2 text-xs"
      trigger={
        <>
          <Brain className="size-3.5 shrink-0 text-agent-soft" aria-hidden />
          <span className="font-mono">{current}</span>
        </>
      }
      items={REASONING_LEVELS.map((value) => ({
        label: value,
        hint: t(LEVEL_HINT[value] ?? 'chat.status.level.none'),
        checked: value === level,
        onSelect: () => {
          if (value !== level) set(value);
        },
      }))}
    />
  );
}

/** Share of the context window in use, 0..1, or null when unknown. */
export function contextShare(
  info: Pick<SessionContextInfo, 'used' | 'contextLength'> | undefined,
): number | null {
  if (info?.used === null || info?.used === undefined || !info.contextLength) return null;
  return Math.min(1, Math.max(0, info.used / info.contextLength));
}

export function ContextMeter({ info }: { info: SessionContextInfo | undefined }) {
  const { t } = useTranslation();
  if (info === undefined || info.used === null) return null;
  const share = contextShare(info);
  const percent = share === null ? null : share * 100;
  const tone =
    share === null
      ? 'bg-text-tertiary'
      : share >= 0.85
        ? 'bg-danger'
        : share >= 0.6
          ? 'bg-warning'
          : 'bg-success';
  const tip = [
    info.contextLength
      ? t('chat.status.contextTipFull', {
          used: info.used.toLocaleString(),
          length: info.contextLength.toLocaleString(),
          pct: percent?.toFixed(1),
        })
      : t('chat.status.contextTipBasic', { used: info.used.toLocaleString() }),
    t('chat.status.contextTipUnknownSize'),
    t('chat.status.contextTipCompress'),
  ]
    .filter((line) => line !== '')
    .join('\n');
  return (
    <span
      tabIndex={0}
      data-tip={tip}
      data-tip-wide
      aria-label={
        percent === null
          ? t('chat.status.contextLabel', { used: compactNumber(info.used) })
          : t('chat.status.contextLabelPercent', { pct: Math.round(percent) })
      }
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 font-mono text-[11px] text-text-tertiary outline-none hover:text-text-secondary focus-visible:text-text-secondary"
    >
      {share !== null ? (
        <span
          className="relative hidden h-1.5 w-10 overflow-hidden rounded-full bg-chip sm:block"
          aria-hidden
        >
          <span
            className={[
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
              tone,
            ].join(' ')}
            style={{ width: `${Math.max(3, share * 100)}%` }}
          />
        </span>
      ) : null}
      <span>
        {percent === null
          ? compactNumber(info.used)
          : `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`}
      </span>
    </span>
  );
}
