import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Eye, KeyRound, Sparkles, Wrench } from 'lucide-react';
import { fetchModelInfo, fetchModelOptions, setModelAssignment } from '../../lib/api';
import { fetchModelsAnalytics } from '../../lib/hx';
import { normalizeCatalog, pickableProviders } from '../../lib/modelCatalog';
import { compactNumber, money, relativeTime } from '../../lib/format';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import {
  Badge,
  Card,
  ErrorNote,
  Section,
  Segmented,
  SkeletonRows,
  Stat,
} from '../../components/ui';
import { ModelBrowser } from '../../components/ModelBrowser';
import { SettingsPage } from './SettingsLayout';

/**
 * Settings > Models: the default model with what it can do, a searchable
 * catalog to change it, provider readiness and recent per-model usage.
 */
export function ModelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ['model-info'], queryFn: fetchModelInfo });
  const options = useQuery({ queryKey: ['model-options'], queryFn: fetchModelOptions });
  const usage = useQuery({
    queryKey: ['analytics-models', 30],
    queryFn: () => fetchModelsAnalytics(30),
  });
  const catalog = useMemo(() => normalizeCatalog(options.data), [options.data]);
  const pickable = useMemo(() => pickableProviders(catalog), [catalog]);

  const assign = useMutation({
    mutationFn: (input: { provider: string; model: string; confirm_expensive_model: boolean }) =>
      setModelAssignment({ scope: 'main', ...input }),
    onError: (error) => toastError(error),
  });

  const choose = async (provider: string, model: string) => {
    const ok = await confirmDialog({
      title: t('settings.models.makeDefaultTitle', { model }),
      description: t('settings.models.makeDefaultDesc'),
      confirmLabel: t('settings.models.setAsDefault'),
    });
    if (!ok) return;
    try {
      let result = (await assign.mutateAsync({
        provider,
        model,
        confirm_expensive_model: false,
      })) as {
        confirm_required?: boolean;
        confirm_message?: string;
      };
      if (result?.confirm_required === true) {
        const again = await confirmDialog({
          title: t('settings.models.expensiveTitle'),
          description: result.confirm_message ?? t('settings.models.expensiveDesc'),
          confirmLabel: t('settings.models.useAnyway'),
          tone: 'danger',
        });
        if (!again) return;
        result = (await assign.mutateAsync({
          provider,
          model,
          confirm_expensive_model: true,
        })) as typeof result;
      }
      toast(t('settings.models.nowDefault', { model }), 'success');
      void queryClient.invalidateQueries({ queryKey: ['model-info'] });
      void queryClient.invalidateQueries({ queryKey: ['model-options'] });
    } catch {
      // toastError already reported it
    }
  };

  const [providerFilter, setProviderFilter] = useState<'all' | 'ready' | 'nokey'>('all');
  const caps = info.data?.capabilities ?? {};
  const context = info.data?.effective_context_length ?? caps.context_window;
  const usedModels = (usage.data?.models ?? []).filter((row) => row.sessions > 0).slice(0, 6);

  return (
    <SettingsPage title={t('settings.models.title')} description={t('settings.models.description')}>
      {info.isError ? (
        <ErrorNote message={info.error.message} onRetry={() => void info.refetch()} />
      ) : info.isPending ? (
        <SkeletonRows rows={2} />
      ) : (
        <Card className="mb-7 overflow-hidden">
          <div className="flex items-start gap-4 px-5 py-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-chip text-accent">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-tertiary">{t('settings.models.defaultModel')}</p>
              <p className="mt-0.5 font-mono text-lg break-all text-text-primary">
                {info.data.model || t('settings.models.notSet')}
              </p>
              <p className="mt-0.5 text-[13px] text-text-secondary">
                {t('settings.models.via', {
                  provider: info.data.provider || t('settings.models.unknownProvider'),
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {caps.supports_tools === true ? (
                  <Badge tone="success">
                    <Wrench className="size-3" aria-hidden /> {t('settings.models.badgeTools')}
                  </Badge>
                ) : null}
                {caps.supports_vision === true ? (
                  <Badge tone="agent">
                    <Eye className="size-3" aria-hidden /> {t('settings.models.badgeVision')}
                  </Badge>
                ) : (
                  <Badge>
                    <Eye className="size-3" aria-hidden /> {t('settings.models.badgeNoVision')}
                  </Badge>
                )}
                {caps.supports_reasoning === true ? (
                  <Badge tone="accent">
                    <Brain className="size-3" aria-hidden /> {t('settings.models.badgeReasoning')}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-border-subtle">
            <div className="border-r border-border-subtle px-5 py-3">
              <p className="text-[11px] text-text-tertiary">{t('settings.models.contextWindow')}</p>
              <p className="font-mono text-sm text-text-primary">
                {context !== undefined
                  ? t('settings.models.tokens', { count: compactNumber(context) })
                  : t('settings.models.unknown')}
              </p>
            </div>
            <div className="px-5 py-3">
              <p className="text-[11px] text-text-tertiary">{t('settings.models.maxOutput')}</p>
              <p className="font-mono text-sm text-text-primary">
                {caps.max_output_tokens !== undefined
                  ? t('settings.models.tokens', { count: compactNumber(caps.max_output_tokens) })
                  : t('settings.models.providerDefault')}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Section
        title={t('settings.models.changeDefault')}
        description={t('settings.models.changeDefaultDesc')}
      >
        <Card className="p-3">
          {options.isError ? (
            <ErrorNote message={options.error.message} onRetry={() => void options.refetch()} />
          ) : options.isPending ? (
            <SkeletonRows rows={4} />
          ) : pickable.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-text-secondary">
              {t('settings.models.noProviderYet')}
            </p>
          ) : (
            <ModelBrowser
              providers={pickable}
              selected={info.data !== undefined ? { provider: '', model: info.data.model } : null}
              busy={assign.isPending}
              maxHeight="max-h-[26rem]"
              onPick={(provider, model) => void choose(provider, model)}
            />
          )}
        </Card>
      </Section>

      {usedModels.length > 0 ? (
        <Section title={t('settings.models.usedTitle')} description={t('settings.models.usedDesc')}>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {usedModels.map((row) => (
              <Stat
                key={`${row.provider}/${row.model}`}
                label={row.model}
                value={t('settings.models.tokens', {
                  count: compactNumber(row.input_tokens + row.output_tokens),
                })}
                hint={t('settings.models.usedHint', {
                  sessions: row.sessions,
                  cost: money(row.estimated_cost),
                  when: relativeTime(row.last_used_at),
                })}
              />
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title={t('settings.models.providersTitle')}
        description={t('settings.models.providersDesc')}
        actions={
          catalog.length > 4 ? (
            <Segmented
              label={t('settings.models.showProviders')}
              value={providerFilter}
              onChange={setProviderFilter}
              options={[
                { value: 'all', label: t('settings.models.filterAll', { count: catalog.length }) },
                {
                  value: 'ready',
                  label: t('settings.models.filterReady', {
                    count: catalog.filter((provider) => provider.ready).length,
                  }),
                },
                {
                  value: 'nokey',
                  label: t('settings.models.filterNoKey', {
                    count: catalog.filter((provider) => !provider.ready).length,
                  }),
                },
              ]}
            />
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          {[...catalog]
            .filter((provider) =>
              providerFilter === 'ready'
                ? provider.ready
                : providerFilter === 'nokey'
                  ? !provider.ready
                  : true,
            )
            .sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name))
            .map((provider) => (
              <span
                key={provider.slug}
                className="yu-card flex h-9 items-center gap-2 rounded-xl px-3 text-[13px]"
                title={
                  provider.ready
                    ? t('settings.models.providerReadyTip', { slug: provider.slug })
                    : t('settings.models.providerNoKeyTip', { slug: provider.slug })
                }
              >
                {provider.ready ? (
                  <span aria-hidden className="size-1.5 rounded-full bg-success" />
                ) : (
                  <KeyRound className="size-3.5 text-warning" aria-hidden />
                )}
                <span className="text-text-primary">{provider.name}</span>
                <span className="font-mono text-[11px] text-text-tertiary">
                  {provider.ready
                    ? t('settings.models.modelsCount', { count: provider.models.length })
                    : t('settings.models.noKeyLabel')}
                </span>
              </span>
            ))}
        </div>
      </Section>
    </SettingsPage>
  );
}
