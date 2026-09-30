import { useMemo, useState } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';
import type { CatalogProvider } from '../lib/modelCatalog';

/**
 * Searchable model list grouped by provider (no native selects).
 *
 * - Provider chips on top filter the list to one provider ("All" by default).
 * - Each provider group collapses from its header. With several providers,
 *   only the default provider and the one holding the selected model start
 *   open; the rest show their name and model count.
 * - Typing a search opens every group that has a match.
 * The selected model shows a check; `busy` disables picking while a save runs.
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
  const [only, setOnly] = useState<string | null>(null);
  const holdsSelected = (provider: CatalogProvider) =>
    selected !== null &&
    provider.models.some((model) => model.id === selected.model) &&
    (selected.provider === '' || selected.provider === provider.slug);
  // Groups the user toggled; the rest follow the default rule.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const startsOpen = (provider: CatalogProvider) => providers.length <= 3 || provider.isCurrent || holdsSelected(provider);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((provider) => only === null || provider.slug === only)
      .map((provider) => ({
        ...provider,
        models:
          q === '' || provider.name.toLowerCase().includes(q) || provider.slug.includes(q)
            ? provider.models
            : provider.models.filter((model) => model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q)),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [providers, query, only]);

  const searching = query.trim() !== '';
  const isOpen = (provider: CatalogProvider) =>
    searching || only !== null ? true : (toggled[provider.slug] ?? startsOpen(provider));
  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0);

  return (
    <div className="flex min-h-0 flex-col">
      <label className="yu-input mb-2 flex h-9 shrink-0 items-center gap-2 rounded-xl px-3">
        <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${totalModels} models`}
          aria-label="Search models"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
        />
      </label>
      {providers.length > 1 ? (
        <div className="mb-2 flex shrink-0 gap-1.5 overflow-x-auto pb-0.5" role="radiogroup" aria-label="Filter by provider">
          {[{ slug: null, name: 'All', count: totalModels, ready: true }, ...providers.map((provider) => ({ slug: provider.slug, name: provider.name, count: provider.models.length, ready: provider.ready }))].map(
            (chip) => {
              const active = only === chip.slug;
              return (
                <button
                  key={chip.slug ?? 'all'}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setOnly(active && chip.slug !== null ? null : chip.slug)}
                  title={chip.ready ? undefined : `${chip.name} has no credential in Hermes yet`}
                  className={[
                    'yu-chip h-7 shrink-0 rounded-full px-2.5 text-[11.5px] transition-colors',
                    active ? 'bg-chip text-text-primary ring-1 ring-accent/50' : 'yu-chip-neutral hover:text-text-primary',
                    chip.ready ? '' : 'opacity-60',
                  ].join(' ')}
                >
                  {chip.name}
                  <span className="font-mono text-[10.5px] text-text-tertiary">{chip.count}</span>
                </button>
              );
            },
          )}
        </div>
      ) : null}
      <div className={['min-h-0 overflow-y-auto pr-1', maxHeight].join(' ')} role="listbox" aria-label="Models">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">No model matches “{query}”.</p>
        ) : (
          filtered.map((provider) => {
            const open = isOpen(provider);
            const hasSelected = holdsSelected(provider);
            return (
              <div key={provider.slug} className="mb-1" role="group" aria-label={provider.name}>
                <button
                  type="button"
                  onClick={() => setToggled((current) => ({ ...current, [provider.slug]: !open }))}
                  aria-expanded={open}
                  disabled={searching || only !== null}
                  className="sticky top-0 z-[1] flex w-full items-center gap-2 rounded-lg bg-surface-elevated px-2 py-1.5 text-left text-[10.5px] font-medium tracking-wide text-text-tertiary uppercase transition-colors hover:text-text-secondary disabled:cursor-default"
                >
                  <ChevronRight aria-hidden className={['size-3 shrink-0 transition-transform', open ? 'rotate-90' : ''].join(' ')} />
                  <span className="truncate">{provider.name}</span>
                  {provider.isCurrent ? <span className="text-accent normal-case">default</span> : null}
                  {!provider.ready ? <span className="normal-case">no key</span> : null}
                  {hasSelected && !open ? <Check className="size-3 text-accent" aria-label="Holds the selected model" /> : null}
                  <span className="ml-auto font-mono normal-case">{provider.models.length}</span>
                </button>
                {open
                  ? provider.models.map((model) => {
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
                            'flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 pl-7 text-left text-[13px] transition-colors disabled:opacity-50',
                            active ? 'bg-chip text-text-primary' : 'text-text-secondary hover:bg-surface-input hover:text-text-primary',
                          ].join(' ')}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={model.id}>
                            {model.label}
                          </span>
                          {active ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
                        </button>
                      );
                    })
                  : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
