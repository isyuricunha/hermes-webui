import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { CatalogProvider } from '../lib/modelCatalog';

/**
 * Searchable model list grouped by provider (no native selects). The
 * selected model shows a check; `busy` disables picking while a save runs.
 */
export function ModelBrowser({
  providers,
  selected,
  onPick,
  busy = false,
  maxHeight = 'max-h-80',
}: {
  providers: CatalogProvider[];
  selected: { provider: string; model: string } | null;
  onPick: (provider: string, model: string) => void;
  busy?: boolean;
  maxHeight?: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return providers;
    return providers
      .map((provider) => ({
        ...provider,
        models: provider.name.toLowerCase().includes(q) || provider.slug.includes(q)
          ? provider.models
          : provider.models.filter((model) => model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q)),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [providers, query]);

  return (
    <div className="flex min-h-0 flex-col">
      <label className="yu-input mb-2 flex h-9 shrink-0 items-center gap-2 rounded-xl px-3">
        <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models or providers"
          aria-label="Search models"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
        />
      </label>
      <div className={['min-h-0 overflow-y-auto pr-1', maxHeight].join(' ')} role="listbox" aria-label="Models">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">No model matches “{query}”.</p>
        ) : (
          filtered.map((provider) => (
            <div key={provider.slug} className="mb-2" role="group" aria-label={provider.name}>
              <p className="sticky top-0 z-[1] flex items-center gap-2 bg-surface-elevated px-2 py-1.5 text-[10.5px] font-medium tracking-wide text-text-tertiary uppercase">
                {provider.name}
                {provider.isCurrent ? <span className="text-accent normal-case">default</span> : null}
                <span className="ml-auto font-mono normal-case">{provider.models.length}</span>
              </p>
              {provider.models.map((model) => {
                const active = selected !== null && selected.model === model.id && (selected.provider === '' || selected.provider === provider.slug);
                return (
                  <button
                    key={`${provider.slug}/${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={busy}
                    onClick={() => onPick(provider.slug, model.id)}
                    className={[
                      'flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors disabled:opacity-50',
                      active ? 'bg-chip text-text-primary' : 'text-text-secondary hover:bg-surface-input hover:text-text-primary',
                    ].join(' ')}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={model.id}>
                      {model.label}
                    </span>
                    {active ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
