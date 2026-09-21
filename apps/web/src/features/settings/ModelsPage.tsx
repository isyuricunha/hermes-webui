import { useQuery } from '@tanstack/react-query';
import { fetchModelInfo, fetchModelOptions } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

export function ModelsPage() {
  const infoQuery = useQuery({ queryKey: ['model-info'], queryFn: fetchModelInfo });
  const optionsQuery = useQuery({ queryKey: ['model-options'], queryFn: fetchModelOptions });

  if (infoQuery.isPending || optionsQuery.isPending) {
    return (
      <SettingsPage title="Models">
        <p className="text-sm text-text-secondary">Loading models…</p>
      </SettingsPage>
    );
  }
  if (infoQuery.isError) {
    return (
      <SettingsPage title="Models">
        <SettingsError message={infoQuery.error.message} />
      </SettingsPage>
    );
  }

  const info = infoQuery.data;
  const contextK =
    info.effective_context_length !== undefined
      ? (info.effective_context_length / 1000).toFixed(0)
      : null;
  return (
    <SettingsPage title="Models">
      <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Main model</p>
        <p className="mt-1 text-lg font-medium">{info.model}</p>
        <p className="text-sm text-text-secondary">
          Provider: {info.provider}
          {contextK !== null ? ` · context ${contextK}k` : ''}
        </p>
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Available providers
      </p>
      {optionsQuery.isError ? (
        <SettingsError message={optionsQuery.error.message} />
      ) : (
        <ProvidersList data={optionsQuery.data} />
      )}
      <p className="mt-4 text-xs text-text-secondary">
        Switching the default model, fallbacks and auxiliary models arrives with the curated Models
        editor.
      </p>
    </SettingsPage>
  );
}

function ProvidersList({ data }: { data: unknown }) {
  const providers =
    typeof data === 'object' && data !== null && Array.isArray((data as { providers?: unknown }).providers)
      ? ((data as { providers: unknown[] }).providers as { slug?: string; authenticated?: boolean; is_current?: boolean }[])
      : [];
  if (providers.length === 0) {
    return <p className="text-sm text-text-secondary">Provider options unavailable.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {providers.map((provider, index) => (
        <li
          key={provider.slug ?? `provider-${index}`}
          className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm"
        >
          <span>{provider.slug ?? 'unknown'}</span>
          <span
            className={
              provider.authenticated
                ? 'text-xs font-medium text-success'
                : 'text-xs font-medium text-warning'
            }
          >
            {provider.authenticated ? 'Ready' : 'No credential'}
          </span>
        </li>
      ))}
    </ul>
  );
}
