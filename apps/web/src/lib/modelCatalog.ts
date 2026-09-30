/**
 * Normalizes the Hermes model catalog (`GET /api/model/options`). Hermes
 * 0.21 answers `{providers: [{slug, name, is_current, authenticated,
 * models: (string | {id, name})[]}]}`; older builds answered a flat
 * `options: ["provider/model", …]`. Both become provider groups.
 */

export interface CatalogModel {
  id: string;
  label: string;
}

export interface CatalogProvider {
  slug: string;
  name: string;
  isCurrent: boolean;
  /** false only when Hermes says the provider has no credential. */
  ready: boolean;
  models: CatalogModel[];
}

function modelOf(raw: unknown): CatalogModel | null {
  if (typeof raw === 'string') return raw === '' ? null : { id: raw, label: raw };
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const id = String(record.id ?? record.model ?? record.name ?? '');
    if (id === '') return null;
    const label = typeof record.name === 'string' && record.name !== '' ? record.name : id;
    return { id, label };
  }
  return null;
}

export function normalizeCatalog(payload: unknown): CatalogProvider[] {
  if (payload === null || typeof payload !== 'object') return [];
  const record = payload as { providers?: unknown; options?: unknown };
  if (Array.isArray(record.providers)) {
    return record.providers.flatMap((raw): CatalogProvider[] => {
      if (raw === null || typeof raw !== 'object') return [];
      const row = raw as Record<string, unknown>;
      const slug = String(row.slug ?? row.id ?? '').trim();
      if (slug === '') return [];
      const models = Array.isArray(row.models) ? row.models.map(modelOf).filter((m): m is CatalogModel => m !== null) : [];
      return [
        {
          slug,
          name: typeof row.name === 'string' && row.name !== '' ? row.name : slug,
          isCurrent: row.is_current === true,
          ready: row.authenticated !== false,
          models,
        },
      ];
    });
  }
  if (Array.isArray(record.options)) {
    const groups = new Map<string, CatalogModel[]>();
    for (const option of record.options) {
      let provider = '';
      let model: CatalogModel | null = null;
      if (typeof option === 'string') {
        const slash = option.indexOf('/');
        provider = slash === -1 ? '' : option.slice(0, slash);
        model = modelOf(slash === -1 ? option : option.slice(slash + 1));
      } else if (option !== null && typeof option === 'object') {
        provider = String((option as { provider?: unknown }).provider ?? '');
        model = modelOf(option);
      }
      if (model !== null) groups.set(provider, [...(groups.get(provider) ?? []), model]);
    }
    return [...groups].map(([slug, models]) => ({ slug, name: slug || 'default', isCurrent: false, ready: true, models }));
  }
  return [];
}

/** Providers you can actually pick from: ready and with models; current first. */
export function pickableProviders(providers: CatalogProvider[]): CatalogProvider[] {
  return providers
    .filter((provider) => provider.ready && provider.models.length > 0)
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name));
}
