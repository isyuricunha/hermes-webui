import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchModelsAnalytics, fetchSessionStats, fetchUsageAnalytics } from '../../lib/hx';
import { compactNumber, money, relativeTime } from '../../lib/format';
import { BarList, ColumnChart } from '../../components/charts';
import { Card, ErrorNote, Section, Segmented, SkeletonRows, Stat } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
] as const;

type Metric = 'tokens' | 'cost' | 'sessions';

const METRICS = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: 'Cost' },
  { value: 'sessions', label: 'Sessions' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  api_server: 'WebUI & API',
  cron: 'Cron',
  cli: 'CLI',
  tui: 'Terminal',
  discord: 'Discord',
};

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Usage (dashboard analytics): tokens, cost and activity over a period. */
export function UsagePage() {
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
  const stats = useQuery({ queryKey: ['session-stats'], queryFn: fetchSessionStats, staleTime: 60_000 });

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
      title="Usage"
      description={
        <>
          What Hermes spent across every channel: Telegram, cron, this app and the API. Numbers come from the Hermes
          session store (token counts each provider reported). Cost is the provider&apos;s billed amount when it reports one,
          otherwise Hermes&apos; estimate from its model price table, so treat it as an approximation; free providers show $0.
        </>
      }
      wide
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented label="Period" options={RANGES} value={days} onChange={setDays} />
      </div>

      {usage.isError ? (
        <ErrorNote message={usage.error.message} onRetry={() => void usage.refetch()} />
      ) : usage.isPending ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className={['transition-opacity', refetching ? 'opacity-60' : ''].join(' ')}>
          <div className="mb-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat
              label="Tokens"
              value={compactNumber((totals?.total_input ?? 0) + (totals?.total_output ?? 0))}
              hint={`${compactNumber(totals?.total_input)} in · ${compactNumber(totals?.total_output)} out`}
            />
            <Stat
              label="Cost (approx.)"
              value={money((totals?.total_actual_cost ?? 0) > 0 ? (totals?.total_actual_cost ?? 0) : (totals?.total_estimated_cost ?? 0))}
              hint={
                (totals?.total_actual_cost ?? 0) > 0
                  ? `billed by providers · ${money(totals?.total_estimated_cost ?? 0)} estimated`
                  : `Hermes estimate · ${compactNumber(totals?.total_cache_read)} tokens from cache`
              }
            />
            <Stat label="Sessions" value={compactNumber(totals?.total_sessions)} hint={`last ${days} days`} />
            <Stat label="API calls" value={compactNumber(totals?.total_api_calls)} hint={`${compactNumber(totals?.total_reasoning)} reasoning tokens`} />
          </div>

          <Section
            title={`Daily ${metric}`}
            actions={<Segmented label="Metric" options={METRICS} value={metric} onChange={setMetric} />}
          >
            <Card className="px-4 pt-6 pb-4">
              {series.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-text-tertiary">No activity in this period.</p>
              ) : (
                <ColumnChart data={series} format={format} label={`Daily ${metric}, last ${days} days`} />
              )}
            </Card>
          </Section>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <Section title="By model" description="Input + output tokens">
              <Card className="p-4">
                {models.isError ? (
                  <ErrorNote message={models.error.message} />
                ) : (models.data?.models ?? []).length === 0 ? (
                  <p className="text-[13px] text-text-tertiary">No model usage yet.</p>
                ) : (
                  <BarList
                    label="Tokens by model"
                    format={compactNumber}
                    rows={(models.data?.models ?? [])
                      .map((model) => ({
                        key: `${model.provider}/${model.model}`,
                        label: model.model,
                        value: model.input_tokens + model.output_tokens,
                        detail: `${money(model.estimated_cost + model.actual_cost)} · ${model.sessions} sessions · ${relativeTime(model.last_used_at)}`,
                      }))
                      .sort((a, b) => b.value - a.value)}
                  />
                )}
              </Card>
            </Section>

            <Section title="Most used skills" description={usage.data?.skills ? `${usage.data.skills.summary.distinct_skills_used} distinct skills, ${usage.data.skills.summary.total_skill_loads} loads` : undefined}>
              <Card className="p-4">
                {(usage.data?.skills?.top_skills ?? []).length === 0 ? (
                  <p className="text-[13px] text-text-tertiary">No skill activity in this period.</p>
                ) : (
                  <BarList
                    label="Skill uses"
                    format={(value) => `${value}×`}
                    rows={(usage.data?.skills?.top_skills ?? []).slice(0, 8).map((skill) => ({
                      key: skill.skill,
                      label: skill.skill,
                      value: skill.total_count,
                      detail: skill.last_used_at !== null ? `last used ${relativeTime(skill.last_used_at)}` : undefined,
                    }))}
                  />
                )}
              </Card>
            </Section>
          </div>

          {stats.data !== undefined ? (
            <Section
              title="Conversations by source"
              description={`${compactNumber(stats.data.total)} conversations · ${compactNumber(stats.data.messages)} messages · ${stats.data.archived} archived`}
            >
              <Card className="p-4">
                <BarList
                  label="Conversations by source"
                  format={compactNumber}
                  rows={Object.entries(stats.data.by_source ?? {})
                    .map(([source, count]) => ({ key: source, label: SOURCE_LABELS[source] ?? source, value: count }))
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
