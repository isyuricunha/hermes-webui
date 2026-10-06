import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, CircleHelp, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import {
  fetchGuidedConfig,
  fetchModelOptions,
  putGuidedConfig,
} from '../../lib/api';
import { normalizeCatalog, pickableProviders } from '../../lib/modelCatalog';
import { ModelBrowser } from '../../components/ModelBrowser';
import type { GuidedConfigOp, GuidedConfigRow } from '@hermes-webui/shared';
import { SettingsError, SettingsPage } from './SettingsLayout';

function helpKeyForPath(path: string): string {
  return 'settings.guidedConfig.help.' + path.replace(/\./g, '_');
}

function tipKeyForPath(path: string): string {
  return 'settings.guidedConfig.tip.' + path.replace(/\./g, '_');
}

function fieldHelpText(
  path: string,
  fallback: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const localized = t(helpKeyForPath(path), { defaultValue: '' });
  if (localized) return localized;
  if (fallback && fallback.trim()) return fallback;
  // Soft fallback so no row looks “empty” while curated copy is still growing.
  return t('settings.guidedConfig.fallbackHelp', { path });
}

function fieldTipText(
  path: string,
  help: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const tip = t(tipKeyForPath(path), { defaultValue: '' });
  return tip || help;
}

function clampNumber(value: number, row: GuidedConfigRow): number {
  let next = value;
  if (!Number.isFinite(next)) return next;
  if (row.integer === true) next = Math.round(next);
  if (row.min !== undefined) next = Math.max(row.min, next);
  if (row.max !== undefined) next = Math.min(row.max, next);
  return next;
}

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

function ModelFieldControl({
  value,
  onChange,
}: {
  value: DraftValue;
  onChange: (value: DraftValue) => void;
}) {
  const { t } = useTranslation();
  const options = useQuery({ queryKey: ['model-options'], queryFn: fetchModelOptions, staleTime: 60_000 });
  const providers = useMemo(
    () => pickableProviders(normalizeCatalog(options.data)),
    [options.data],
  );
  const current = value === null || value === undefined ? '' : String(value);
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="w-full min-w-0 max-w-3xl">
      {options.isPending ? (
        <p className="text-xs text-text-tertiary">{t('settings.guidedConfig.modelLoading')}</p>
      ) : options.isError ? (
        <p className="mb-2 text-xs text-danger">{t('settings.guidedConfig.modelLoadFailed')}</p>
      ) : null}

      {!options.isPending && !options.isError && providers.length === 0 ? (
        <p className="mb-2 text-xs text-text-tertiary">{t('settings.guidedConfig.modelEmpty')}</p>
      ) : null}

      {providers.length > 0 ? (
        <ModelBrowser
          providers={providers}
          selected={current ? { provider: '', model: current } : null}
          onPick={(_provider, model) => onChange(model)}
          maxHeight="max-h-72"
        />
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowCustom((open) => !open)}
          className="text-[12px] text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
        >
          {showCustom
            ? t('settings.guidedConfig.modelCustomHide')
            : t('settings.guidedConfig.modelCustomShow')}
        </button>
        {showCustom || providers.length === 0 ? (
          <input
            type="text"
            value={current}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t('settings.guidedConfig.modelCustomPlaceholder')}
            spellCheck={false}
            className="yu-input mt-2 h-10 w-full rounded-xl px-3 font-mono text-[12.5px]"
          />
        ) : null}
      </div>
    </div>
  );
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
  const { t } = useTranslation();
  const inputClass = 'yu-input h-9 w-full max-w-md rounded-xl px-3 text-[13px]';

  if (row.path === 'model' || row.path === 'model.default') {
    return <ModelFieldControl value={value} onChange={onChange} />;
  }

  if (row.type === 'boolean') {
    const checked = value === true;
    const onLabel = t('settings.guidedConfig.booleanOn');
    const offLabel = t('settings.guidedConfig.booleanOff');
    return (
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <span className={['text-[12px]', checked ? 'text-text-tertiary' : 'font-medium text-text-primary'].join(' ')}>
            {offLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={checked ? onLabel : offLabel}
            onClick={() => onChange(!checked)}
            className={[
              'flex h-9 w-14 shrink-0 items-center rounded-full border px-1 transition-colors',
              checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-input',
            ].join(' ')}
          >
            <span
              className={[
                'size-7 rounded-full bg-background shadow-sm transition-transform',
                checked ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')}
            />
          </button>
          <span className={['text-[12px]', checked ? 'font-medium text-text-primary' : 'text-text-tertiary'].join(' ')}>
            {onLabel}
          </span>
        </div>
        <p className="text-[11px] leading-4 text-text-tertiary">
          {checked
            ? t('settings.guidedConfig.booleanOnHint')
            : t('settings.guidedConfig.booleanOffHint')}
        </p>
      </div>
    );
  }

  if (row.type === 'select' && row.options && row.options.length > 0) {
    const useSearchable = row.searchable === true || row.options.length > 12;
    if (useSearchable) {
      const listId = 'guided-options-' + row.path.replace(/[^A-Za-z0-9_-]/g, '-');
      return (
        <div className="w-full max-w-md">
          <input
            value={value === null ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
            list={listId}
            className={inputClass}
            spellCheck={false}
            placeholder={t('settings.guidedConfig.selectSearchPlaceholder')}
          />
          <datalist id={listId}>
            {row.clearable ? <option value="" /> : null}
            {row.options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
      );
    }
    return (
      <select
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        {row.clearable ? (
          <option value="">{t('settings.guidedConfig.selectDefault')}</option>
        ) : null}
        {row.options.map((option) => (
          <option key={option} value={option}>
            {option || t('settings.guidedConfig.selectDefault')}
          </option>
        ))}
      </select>
    );
  }

  if (row.type === 'number') {
    const hasBounds = row.min !== undefined || row.max !== undefined;
    const rangeLabel =
      row.min !== undefined && row.max !== undefined
        ? t('settings.guidedConfig.rangeBoth', { min: row.min, max: row.max })
        : row.min !== undefined
          ? t('settings.guidedConfig.rangeMin', { min: row.min })
          : row.max !== undefined
            ? t('settings.guidedConfig.rangeMax', { max: row.max })
            : t('settings.guidedConfig.rangeOpen');
    return (
      <div className="flex w-full max-w-md flex-col gap-1">
        <input
          type="number"
          value={value === null ? '' : String(value)}
          min={row.min}
          max={row.max}
          step={row.integer === true ? 1 : 'any'}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            // Never push NaN/Infinity into drafts — those become `.nan` in YAML
            // and break the Hermes dashboard JSON API.
            if (!Number.isFinite(parsed)) return;
            onChange(parsed);
          }}
          onBlur={() => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return;
            const clamped = clampNumber(value, row);
            if (clamped !== value) onChange(clamped);
          }}
          className={inputClass}
          spellCheck={false}
        />
        <p className="text-[11px] leading-4 text-text-tertiary">
          {rangeLabel}
          {row.integer === true ? (
            <span className="ml-1.5">{t('settings.guidedConfig.integerOnly')}</span>
          ) : null}
          {hasBounds ? (
            <span className="ml-1.5">{t('settings.guidedConfig.rangeEnforced')}</span>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
      spellCheck
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
      const help = (row.help ?? '').toLowerCase();
      return (
        row.path.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q) ||
        help.includes(q)
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
      wide
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
            const titleKey = `settings.guidedConfig.categories.${category}.title`;
            const descKey = `settings.guidedConfig.categories.${category}.description`;
            const categoryTitle = t(titleKey, { defaultValue: category });
            const categoryDescription = t(descKey, { defaultValue: '' });
            return (
              <details key={category} open={search.trim() !== ''} className="yu-card overflow-hidden rounded-2xl">
                <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3">
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{categoryTitle}</span>
                      <span className="text-xs text-text-tertiary">{categoryRows.length}</span>
                    </div>
                    {categoryDescription ? (
                      <p className="mt-1 text-xs leading-5 text-text-secondary">{categoryDescription}</p>
                    ) : null}
                  </div>
                </summary>
                <div className="divide-y divide-border-subtle border-t border-border-subtle">
                  {categoryRows.map((row) => {
                    const value = valueFor(row, drafts);
                    const dirty = isDirty(row, drafts);
                    const isModelField = row.path === 'model' || row.path === 'model.default';
                    return (
                      <div key={row.path} className={['p-4', dirty ? 'bg-accent/5' : ''].join(' ')}>
                        <div
                          className={
                            isModelField
                              ? 'flex flex-col gap-3'
                              : 'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'
                          }
                        >
                          <div className={isModelField ? 'min-w-0' : 'min-w-0 lg:max-w-[52%]'}>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[13px] font-medium text-text-primary">{row.description}</p>
                              {(() => {
                                const help = fieldHelpText(row.path, row.help, t);
                                const tip = fieldTipText(row.path, help, t);
                                if (!tip) return null;
                                return (
                                  <button
                                    type="button"
                                    className="inline-flex size-5 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-chip hover:text-text-secondary"
                                    data-tip={tip}
                                    data-tip-wide
                                    aria-label={t('settings.guidedConfig.helpAria', { field: row.description })}
                                  >
                                    <CircleHelp className="size-3.5" aria-hidden />
                                  </button>
                                );
                              })()}
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
                            {(() => {
                              const localized = fieldHelpText(row.path, row.help, t);
                              return localized ? (
                                <p className="mt-1 text-xs leading-5 text-text-secondary">{localized}</p>
                              ) : null;
                            })()}
                            <p className="mt-1 break-all font-mono text-[10.5px] text-text-tertiary">{row.path}</p>
                            <p className="mt-1 text-xs text-text-tertiary">
                              {t('settings.guidedConfig.defaultLabel', { value: rowDefaultLabel(row, t) })}
                            </p>
                          </div>
                          <div className={isModelField ? 'flex min-w-0 items-start gap-2' : 'flex min-w-0 items-center gap-2 lg:w-[44%]'}> 
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
