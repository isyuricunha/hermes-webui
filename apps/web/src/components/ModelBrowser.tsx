import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { CatalogProvider } from '../lib/modelCatalog';

/**
 * Searchable model catalog grouped by provider.
 *
 * Layout (always full width, no chip overflow):
 * 1. Search field
 * 2. Provider filter as a select (All + each provider)
 * 3. Scrollable list — flat when a provider is selected or the user is
 *    searching; otherwise grouped headers without nested accordion friction
 */
export function ModelBrowser({
  providers,
  selected,
  onPick,
  busy = false,
  maxHeight = 'max-h-72',
}: {
  providers: CatalogProvider[];
  selected: { provider: string; model: string } | null;
  onPick: (provider: string, model: string) => void;
  busy?: boolean;
  maxHeight?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<string>('');

  const totalModels = useMemo(
    () => providers.reduce((sum, provider) => sum + provider.models.length, 0),
    [providers],
  );

  let selectedMeta: {
    provider: CatalogProvider | null;
    model: { id: string; label: string };
  } | null = null;
  if (selected !== null && selected.model !== '') {
    selectedMeta = {
      provider: null,
      model: { id: selected.model, label: selected.model },
    };
    for (const provider of providers) {
      if (selected.provider && selected.provider !== provider.slug) continue;
      const model = provider.models.find((entry) => entry.id === selected.model);
      if (model) {
        selectedMeta = { provider, model };
        break;
      }
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((provider) => only === '' || provider.slug === only)
      .map((provider) => ({
        ...provider,
        models:
          q === ''
            ? provider.models
            : provider.models.filter(
                (model) =>
                  model.id.toLowerCase().includes(q) ||
                  model.label.toLowerCase().includes(q) ||
                  provider.name.toLowerCase().includes(q) ||
                  provider.slug.toLowerCase().includes(q),
              ),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [providers, query, only]);

  const flat = only !== '' || query.trim() !== '';
  const matchCount = filtered.reduce((sum, provider) => sum + provider.models.length, 0);

  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      {selectedMeta ? (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-accent/25 bg-accent/5 px-3 py-2">
          <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] text-text-primary">{selectedMeta.model.label}</p>
            <p className="truncate text-[11px] text-text-tertiary">
              {selectedMeta.provider
                ? selectedMeta.provider.name
                : t('modelBrowser.customModel')}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="yu-input flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3">
          <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('modelBrowser.searchPlaceholder', { count: totalModels })}
            aria-label={t('modelBrowser.searchAria')}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
          />
        </label>

        {providers.length > 1 ? (
          <label className="relative block shrink-0 sm:w-52">
            <span className="sr-only">{t('modelBrowser.filterAria')}</span>
            <select
              value={only}
              onChange={(event) => setOnly(event.target.value)}
              className="yu-input h-10 w-full appearance-none rounded-xl px-3 pr-9 text-[13px]"
            >
              <option value="">{t('modelBrowser.allChip')} ({totalModels})</option>
              {providers.map((provider) => (
                <option key={provider.slug} value={provider.slug}>
                  {provider.name} ({provider.models.length})
                  {provider.isCurrent ? ` · ${t('modelBrowser.defaultChip')}` : ''}
                  {!provider.ready ? ` · ${t('settings.models.noKeyLabel')}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-text-tertiary"
              aria-hidden
            />
          </label>
        ) : null}
      </div>

      <p className="text-[11px] text-text-tertiary">
        {t('modelBrowser.matchCount', { count: matchCount })}
      </p>

      <div
        className={['min-h-[12rem] overflow-y-auto rounded-xl border border-border-subtle bg-surface-input/40', maxHeight].join(' ')}
        role="listbox"
        aria-label={t('settings.nav.models')}
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-tertiary">
            {t('modelBrowser.noMatch', { query })}
          </p>
        ) : flat ? (
          <ul className="p-1">
            {filtered.flatMap((provider) =>
              provider.models.map((model) => {
                const active =
                  selected !== null &&
                  selected.model === model.id &&
                  (selected.provider === '' || selected.provider === provider.slug);
                return (
                  <li key={`${provider.slug}/${model.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={busy}
                      onClick={() => onPick(provider.slug, model.id)}
                      className={[
                        'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-50',
                        active
                          ? 'bg-chip text-text-primary'
                          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
                      ].join(' ')}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12.5px]">{model.label}</p>
                        <p className="truncate text-[10.5px] text-text-tertiary">{provider.name}</p>
                      </div>
                      {active ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        ) : (
          <div className="p-1">
            {filtered.map((provider) => (
              <div key={provider.slug} className="mb-2">
                <div className="sticky top-0 z-[1] flex items-center gap-2 bg-surface-input/95 px-3 py-1.5 text-[11px] font-medium text-text-tertiary backdrop-blur">
                  <span className="truncate">{provider.name}</span>
                  {provider.isCurrent ? (
                    <span className="text-accent">{t('modelBrowser.defaultChip')}</span>
                  ) : null}
                  <span className="ml-auto font-mono">{provider.models.length}</span>
                </div>
                <ul>
                  {provider.models.map((model) => {
                    const active =
                      selected !== null &&
                      selected.model === model.id &&
                      (selected.provider === '' || selected.provider === provider.slug);
                    return (
                      <li key={`${provider.slug}/${model.id}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          disabled={busy}
                          onClick={() => onPick(provider.slug, model.id)}
                          className={[
                            'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-50',
                            active
                              ? 'bg-chip text-text-primary'
                              : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
                          ].join(' ')}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={model.id}>
                            {model.label}
                          </span>
                          {active ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
