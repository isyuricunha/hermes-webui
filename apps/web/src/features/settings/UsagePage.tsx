import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchModelsAnalytics, fetchSessionStats, fetchUsageAnalytics } from '../../lib/hx';
import { compactNumber, money, relativeTime } from '../../lib/format';
import { BarList, ColumnChart } from '../../components/charts';
import { Card, ErrorNote, Section, Segmented, SkeletonRows, Stat } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const RANGES = [
  { value: 7, label: 'settings.usage.range7' },
  { value: 30, label: 'settings.usage.range30' },
  { value: 90, label: 'settings.usage.range90' },
] as const;

type Metric = 'tokens' | 'cost' | 'sessions';

const METRICS = [
  { value: 'tokens', label: 'settings.usage.metricTokens' },
  { value: 'cost', label: 'settings.usage.metricCost' },
  { value: 'sessions', label: 'settings.usage.metricSessions' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'settings.usage.sourceTelegram',
  api_server: 'settings.usage.sourceWebuiApi',
  cron: 'settings.usage.sourceCron',
  cli: 'settings.usage.sourceCli',
  tui: 'settings.usage.sourceTerminal',
  discord: 'settings.usage.sourceDiscord',
};

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Usage (dashboard analytics): tokens, cost and activity over a period. */
export function UsagePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<Metric>('tokens');
  const usage = useQuery({
    queryKey: ['analytics-usage', days],
    queryFn: () => fetchUsageAnalytics(days),
    placeholderData: keepPreviousData,
  });
  const models = useQuery({
    queryKey: ['analytics-models', days],
    queryFn: () => fetchModelsAnalytics(days),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({
    queryKey: ['session-stats'],
    queryFn: fetchSessionStats,
    staleTime: 60_000,
  });

  const totals = usage.data?.totals;
  const daily = usage.data?.daily ?? [];
  const series = daily.map((entry) => ({
    key: entry.day,
    label: dayLabel(entry.day),
    value:
      metric === 'tokens'
        ? entry.input_tokens + entry.output_tokens
        : metric === 'cost'
          ? entry.actual_cost > 0
            ? entry.actual_cost
            : entry.estimated_cost
          : entry.sessions,
  }));
  const format = metric === 'cost' ? money : compactNumber;
  const refetching = usage.isFetching && usage.isPlaceholderData;

  return (
    <SettingsPage
      title={t('settings.usage.title')}
      description={<>{t('settings.usage.description')}</>}
      wide
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented
          label={t('settings.usage.period')}
          options={RANGES.map((r) => ({ ...r, label: t(r.label) }))}
          value={days}
          onChange={setDays}
        />
      </div>

      {usage.isError ? (
        <ErrorNote message={usage.error.message} onRetry={() => void usage.refetch()} />
      ) : usage.isPending ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className={['transition-opacity', refetching ? 'opacity-60' : ''].join(' ')}>
          <div className="mb-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat
              label={t('settings.usage.metricTokens')}
              value={compactNumber((totals?.total_input ?? 0) + (totals?.total_output ?? 0))}
              hint={t('settings.usage.inOut', {
                in: compactNumber(totals?.total_input),
                out: compactNumber(totals?.total_output),
              })}
            />
            <Stat
              label={t('settings.usage.costApprox')}
              value={money(
                (totals?.total_actual_cost ?? 0) > 0
                  ? (totals?.total_actual_cost ?? 0)
                  : (totals?.total_estimated_cost ?? 0),
              )}
              hint={
                (totals?.total_actual_cost ?? 0) > 0
                  ? t('settings.usage.billedByProviders', {
                      cost: money(totals?.total_estimated_cost ?? 0),
                    })
                  : t('settings.usage.hermesEstimate', {
                      tokens: compactNumber(totals?.total_cache_read),
                    })
              }
            />
            <Stat
              label={t('settings.usage.metricSessions')}
              value={compactNumber(totals?.total_sessions)}
              hint={t('settings.usage.lastDays', { count: days })}
            />
            <Stat
              label={t('settings.usage.apiCalls')}
              value={compactNumber(totals?.total_api_calls)}
              hint={t('settings.usage.reasoningTokens', {
                count: compactNumber(totals?.total_reasoning),
              })}
            />
          </div>

          <Section
            title={t('settings.usage.dailyTitle', { metric })}
            actions={
              <Segmented
                label={t('settings.usage.metricLabel')}
                options={METRICS.map((m) => ({ ...m, label: t(m.label) }))}
                value={metric}
                onChange={setMetric}
              />
            }
          >
            <Card className="px-4 pt-6 pb-4">
              {series.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-text-tertiary">
                  {t('settings.usage.noActivity')}
                </p>
              ) : (
                <ColumnChart
                  data={series}
                  format={format}
                  label={t('settings.usage.chartLabel', { metric, count: days })}
                />
              )}
            </Card>
          </Section>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <Section
              title={t('settings.usage.byModel')}
              description={t('settings.usage.byModelDesc')}
            >
              <Card className="p-4">
                {models.isError ? (
                  <ErrorNote message={models.error.message} />
                ) : (models.data?.models ?? []).length === 0 ? (
                  <p className="text-[13px] text-text-tertiary">
                    {t('settings.usage.noModelUsage')}
                  </p>
                ) : (
                  <BarList
                    label={t('settings.usage.tokensByModel')}
                    format={compactNumber}
                    rows={(models.data?.models ?? [])
                      .map((model) => ({
                        key: `${model.provider}/${model.model}`,
                        label: model.model,
                        value: model.input_tokens + model.output_tokens,
                        detail: t('settings.usage.modelDetail', {
                          cost: money(model.estimated_cost + model.actual_cost),
                          count: model.sessions,
                          when: relativeTime(model.last_used_at),
                        }),
                      }))
                      .sort((a, b) => b.value - a.value)}
                  />
                )}
              </Card>
            </Section>

            <Section
              title={t('settings.usage.mostUsedSkills')}
              description={
                usage.data?.skills
                  ? t('settings.usage.skillsSummary', {
                      distinct: usage.data.skills.summary.distinct_skills_used,
                      loads: usage.data.skills.summary.total_skill_loads,
                    })
                  : undefined
              }
            >
              <Card className="p-4">
                {(usage.data?.skills?.top_skills ?? []).length === 0 ? (
                  <p className="text-[13px] text-text-tertiary">
                    {t('settings.usage.noSkillActivity')}
                  </p>
                ) : (
                  <BarList
                    label={t('settings.usage.skillUses')}
                    format={(value) => `${value}×`}
                    rows={(usage.data?.skills?.top_skills ?? []).slice(0, 8).map((skill) => ({
                      key: skill.skill,
                      label: skill.skill,
                      value: skill.total_count,
                      detail:
                        skill.last_used_at !== null
                          ? t('settings.usage.lastUsed', { when: relativeTime(skill.last_used_at) })
                          : undefined,
                    }))}
                  />
                )}
              </Card>
            </Section>
          </div>

          {stats.data !== undefined ? (
            <Section
              title={t('settings.usage.bySource')}
              description={t('settings.usage.bySourceDesc', {
                count: compactNumber(stats.data.total),
                messages: compactNumber(stats.data.messages),
                archived: stats.data.archived,
              })}
            >
              <Card className="p-4">
                <BarList
                  label={t('settings.usage.bySource')}
                  format={compactNumber}
                  rows={Object.entries(stats.data.by_source ?? {})
                    .map(([source, count]) => ({
                      key: source,
                      label:
                        SOURCE_LABELS[source] !== undefined ? t(SOURCE_LABELS[source]!) : source,
                      value: count,
                    }))
                    .sort((a, b) => b.value - a.value)}
                />
              </Card>
            </Section>
          ) : null}
        </div>
      )}
    </SettingsPage>
  );
}
