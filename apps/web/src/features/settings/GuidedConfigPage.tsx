import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import {
  fetchGuidedConfig,
  putGuidedConfig,
} from '../../lib/api';
import type { GuidedConfigOp, GuidedConfigRow } from '@hermes-webui/shared';
import { SettingsError, SettingsPage } from './SettingsLayout';

type DraftValue = string | number | boolean | null;

function displayValue(value: DraftValue, type: string): string {
  if (value === null) return '—';
  if (type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function rowDefaultLabel(row: GuidedConfigRow, t: (key: string) => string): string {
  return row.defaultValue === null
    ? t('settings.guidedConfig.notAvailable')
    : displayValue(row.defaultValue, row.type);
}

function valueFor(row: GuidedConfigRow, drafts: Record<string, DraftValue>): DraftValue {
  return Object.prototype.hasOwnProperty.call(drafts, row.path) ? drafts[row.path] ?? null : row.value;
}

function isDirty(row: GuidedConfigRow, drafts: Record<string, DraftValue>): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, row.path) && valueFor(row, drafts) !== row.value;
}

function Control({
  row,
  value,
  onChange,
}: {
  row: GuidedConfigRow;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
}) {
  const inputClass = 'yu-input h-9 w-full max-w-md rounded-xl px-3 text-[13px]';

  if (row.type === 'boolean') {
    const checked = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'flex h-9 w-16 items-center rounded-full border px-1 transition-colors',
          checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-input',
        ].join(' ')}
      >
        <span
          className={[
            'size-7 rounded-full bg-background shadow-sm transition-transform',
            checked ? 'translate-x-7' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    );
  }

  if (row.type === 'select' && row.options && row.options.length > 0 && row.options.length <= 80) {
    return (
      <select
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        {row.clearable ? <option value="">Default / automatic</option> : null}
        {row.options.map((option) => (
          <option key={option} value={option}>
            {option || 'Default / automatic'}
          </option>
        ))}
      </select>
    );
  }

  if (row.type === 'select' && row.options && row.options.length > 80) {
    const listId = 'guided-options-' + row.path.replace(/[^A-Za-z0-9_-]/g, '-');
    return (
      <>
        <input
          value={value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          list={listId}
          className={inputClass}
          spellCheck={false}
        />
        <datalist id={listId}>
          {row.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <input
      type={row.type === 'number' ? 'number' : 'text'}
      value={value === null ? '' : String(value)}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(row.type === 'number' ? (raw === '' ? null : Number(raw)) : raw);
      }}
      className={inputClass}
      spellCheck={row.type !== 'number'}
    />
  );
}

export function GuidedConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['config-guided'],
    queryFn: fetchGuidedConfig,
    staleTime: 60_000,
  });
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [reviewing, setReviewing] = useState(false);
  const [search, setSearch] = useState('');
  const [showOverriddenOnly, setShowOverriddenOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => query.data?.rows ?? [], [query.data?.rows]);
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (showOverriddenOnly && !row.isSet && !isDirty(row, drafts)) return false;
      if (!q) return true;
      return (
        row.path.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q)
      );
    });
  }, [drafts, rows, search, showOverriddenOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, GuidedConfigRow[]>();
    for (const row of visibleRows) {
      const bucket = map.get(row.category) ?? [];
      bucket.push(row);
      map.set(row.category, bucket);
    }
    return map;
  }, [visibleRows]);

  const ops = useMemo<GuidedConfigOp[]>(() => {
    const result: GuidedConfigOp[] = [];
    for (const row of rows) {
      if (!isDirty(row, drafts)) continue;
      const value = valueFor(row, drafts);
      if (value === null) continue;
      result.push({
        op: 'set',
        path: row.path,
        value,
        ...(row.tier === 'confirm' ? { confirm: true } : {}),
      });
    }
    return result;
  }, [drafts, rows]);

  const resets = useMemo<GuidedConfigOp[]>(() => {
    const result: GuidedConfigOp[] = [];
    for (const row of rows) {
      if (!isDirty(row, drafts)) continue;
      if (row.isSet && valueFor(row, drafts) === row.defaultValue) {
        result.push({
          op: 'unset',
          path: row.path,
          ...(row.tier === 'confirm' ? { confirm: true } : {}),
        });
      }
    }
    return result;
  }, [drafts, rows]);

  const pendingOps = useMemo(() => {
    const resetPaths = new Set(resets.map((op) => op.path));
    return [...resets, ...ops.filter((op) => !resetPaths.has(op.path))];
  }, [ops, resets]);

  const categories = useMemo(
    () => [
      ...query.data?.categoryOrder ?? [],
      ...Array.from(grouped.keys()).filter((category) => !(query.data?.categoryOrder ?? []).includes(category)),
    ],
    [grouped, query.data?.categoryOrder],
  );

  const confirmCount = pendingOps.filter((op) => rows.find((row) => row.path === op.path)?.tier === 'confirm').length;

  const setDraft = (row: GuidedConfigRow, value: DraftValue) => {
    setError(null);
    setDrafts((current) => ({ ...current, [row.path]: value }));
  };

  const resetDraft = (row: GuidedConfigRow) => {
    setError(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.path];
      return next;
    });
  };

  const apply = async () => {
    if (pendingOps.length === 0 || query.data === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const result = await putGuidedConfig(query.data.rev, pendingOps);
      queryClient.setQueryData(['config-guided'], result.state);
      setDrafts({});
      setReviewing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.guidedConfig.saveFailed'));
      setReviewing(false);
      void queryClient.invalidateQueries({ queryKey: ['config-guided'] });
    } finally {
      setSaving(false);
    }
  };

  if (query.isPending) {
    return (
      <SettingsPage title={t('settings.guidedConfig.title')}>
        <p className="text-sm text-text-secondary">{t('settings.guidedConfig.loading')}</p>
      </SettingsPage>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <SettingsPage title={t('settings.guidedConfig.title')}>
        <SettingsError message={query.error?.message ?? t('settings.guidedConfig.loadFailed')} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={t('settings.guidedConfig.title')}
      description={t('settings.guidedConfig.description')}
      actions={
        <div className="flex items-center gap-2">
          <Link to="/settings/advanced/config" className="yu-btn yu-btn-tonal h-9 px-3.5 text-[13px]">
            {t('settings.guidedConfig.rawLink')}
          </Link>
        </div>
      }
    >
      <div className="yu-card rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip">
            <SlidersHorizontal className="size-4 text-accent" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{t('settings.guidedConfig.howItWorksTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              {t('settings.guidedConfig.howItWorks')}
            </p>
            {query.data.hiddenCount > 0 ? (
              <p className="mt-2 text-xs text-text-tertiary">
                {t('settings.guidedConfig.hidden', { count: query.data.hiddenCount })}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="yu-input flex h-9 flex-1 items-center gap-2 rounded-xl px-2.5">
          <Search className="size-3.5 text-text-tertiary" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('settings.guidedConfig.searchPlaceholder')}
            aria-label={t('settings.guidedConfig.searchAria')}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
          />
        </label>
        <label className="yu-input flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-text-secondary">
          <input
            type="checkbox"
            checked={showOverriddenOnly}
            onChange={(event) => setShowOverriddenOnly(event.target.checked)}
          />
          {t('settings.guidedConfig.overriddenOnly')}
        </label>
      </div>

      {pendingOps.length > 0 ? (
        <div className="sticky bottom-3 z-20 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {t('settings.guidedConfig.pending', { count: pendingOps.length })}
            </p>
            {confirmCount > 0 ? (
              <p className="mt-0.5 text-xs text-text-secondary">
                {t('settings.guidedConfig.confirmPending', { count: confirmCount })}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {reviewing ? (
              <button type="button" onClick={() => setReviewing(false)} className="yu-btn yu-btn-secondary h-9 px-3 text-sm">
                {t('settings.guidedConfig.cancelReview')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => setReviewing((current) => !current)}
              className="yu-btn yu-btn-primary h-9 px-3.5 text-sm"
            >
              {reviewing ? t('settings.guidedConfig.apply') : t('settings.guidedConfig.review')}
            </button>
          </div>
        </div>
      ) : null}

      {reviewing ? (
        <div className="mt-3 yu-card rounded-2xl p-4">
          <p className="text-sm font-medium">{t('settings.guidedConfig.reviewTitle')}</p>
          <p className="mt-1 text-xs text-text-secondary">{t('settings.guidedConfig.reviewDescription')}</p>
          <div className="mt-3 space-y-2">
            {pendingOps.map((op) => {
              const row = rows.find((item) => item.path === op.path);
              if (row === undefined) return null;
              const nextValue = op.op === 'unset' ? row.defaultValue : op.value;
              return (
                <div key={op.path} className="rounded-xl bg-surface-input px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-text-primary">{row.description}</p>
                      <p className="mt-0.5 break-all font-mono text-[10.5px] text-text-tertiary">{row.path}</p>
                    </div>
                    {row.tier === 'confirm' ? (
                      <span className="shrink-0 rounded-full bg-warning/10 px-2 py-1 text-[10px] font-medium text-warning">
                        {t('settings.guidedConfig.confirmBadge')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">
                    {displayValue(row.value, row.type)} <span className="px-1 text-text-tertiary">→</span>{' '}
                    {displayValue(nextValue, row.type)}
                    {op.op === 'unset' ? (
                      <span className="ml-1 text-text-tertiary">({t('settings.guidedConfig.resetAction')})</span>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={apply} disabled={saving} className="yu-btn yu-btn-primary px-4 py-2 text-sm">
              {saving ? t('settings.guidedConfig.saving') : t('settings.guidedConfig.apply')}
            </button>
            <button type="button" onClick={() => setReviewing(false)} disabled={saving} className="yu-btn yu-btn-secondary px-4 py-2 text-sm">
              {t('settings.guidedConfig.cancelReview')}
            </button>
          </div>
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <div className="mt-3 yu-card rounded-2xl p-6 text-sm text-text-secondary">
          {t('settings.guidedConfig.noMatches')}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {categories.map((category) => {
            const categoryRows = grouped.get(category);
            if (categoryRows === undefined || categoryRows.length === 0) return null;
            return (
              <details key={category} open={search.trim() !== ''} className="yu-card overflow-hidden rounded-2xl">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
                  <ChevronDown className="size-4 text-text-tertiary transition-transform group-open:rotate-180" aria-hidden />
                  <span className="text-sm font-medium text-text-primary">{category}</span>
                  <span className="ml-auto text-xs text-text-tertiary">{categoryRows.length}</span>
                </summary>
                <div className="divide-y divide-border-subtle border-t border-border-subtle">
                  {categoryRows.map((row) => {
                    const value = valueFor(row, drafts);
                    const dirty = isDirty(row, drafts);
                    return (
                      <div key={row.path} className={['p-4', dirty ? 'bg-accent/5' : ''].join(' ')}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 lg:max-w-[52%]">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[13px] font-medium text-text-primary">{row.description}</p>
                              {row.tier === 'confirm' ? (
                                <span className="rounded-full bg-warning/10 px-2 py-1 text-[10px] font-medium text-warning">
                                  {t('settings.guidedConfig.confirmBadge')}
                                </span>
                              ) : (
                                <span className="rounded-full bg-chip px-2 py-1 text-[10px] text-text-tertiary">
                                  {t('settings.guidedConfig.safeBadge')}
                                </span>
                              )}
                              {row.isSet ? (
                                <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">
                                  {t('settings.guidedConfig.overriddenBadge')}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-all font-mono text-[10.5px] text-text-tertiary">{row.path}</p>
                            <p className="mt-1 text-xs text-text-secondary">
                              {t('settings.guidedConfig.defaultLabel', { value: rowDefaultLabel(row, t) })}
                            </p>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 lg:w-[44%]">
                            <div className="min-w-0 flex-1">
                              <Control row={row} value={value} onChange={(next) => setDraft(row, next)} />
                            </div>
                            {(row.isSet || dirty) ? (
                              <button
                                type="button"
                                className="yu-btn yu-btn-ghost size-9 shrink-0 rounded-lg"
                                title={t('settings.guidedConfig.reset')}
                                aria-label={t('settings.guidedConfig.resetAria', { path: row.path })}
                                onClick={() => {
                                  if (row.isSet) {
                                    setDraft(row, row.defaultValue);
                                  } else {
                                    resetDraft(row);
                                  }
                                }}
                              >
                                <RotateCcw className="size-4" aria-hidden />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {query.data.rows.some((row) => row.masked) ? (
        <p className="mt-3 text-xs text-text-tertiary">{t('settings.guidedConfig.secretsNote')}</p>
      ) : null}
    </SettingsPage>
  );
}
