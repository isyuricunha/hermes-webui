import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  fetchModelInfo,
  fetchModelOptions,
  setModelAssignment,
} from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

interface ProviderOption {
  slug?: string;
  is_current?: boolean;
  authenticated?: boolean;
  models?: unknown[];
}

export function ModelsPage() {
  const queryClient = useQueryClient();
  const infoQuery = useQuery({ queryKey: ['model-info'], queryFn: fetchModelInfo });
  const optionsQuery = useQuery({ queryKey: ['model-options'], queryFn: fetchModelOptions });

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<string | null>(null);

  const assign = useMutation({
    mutationFn: (input: {
      provider: string;
      model: string;
      confirm_expensive_model: boolean;
    }) => setModelAssignment({ scope: 'main', ...input }),
    onSuccess: (data, input) => {
      const result = data as { ok?: boolean; confirm_required?: boolean; confirm_message?: string };
      if (result?.confirm_required && !input.confirm_expensive_model) {
        setNeedsConfirm(input.model);
        setMessage(result.confirm_message ?? 'This model may be expensive. Click Apply to proceed.');
      } else {
        setNeedsConfirm(null);
        setMessage('Model assigned. Applies to new sessions.');
        void queryClient.invalidateQueries({ queryKey: ['model-info'] });
      }
    },
    onError: (assignError) => setMessage(assignError.message),
  });

  const apply = (confirm: boolean) => {
    if (provider === '' || model === '') return;
    assign.mutate({ provider, model, confirm_expensive_model: confirm });
  };

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

  const providers =
    typeof optionsQuery.data === 'object' &&
    optionsQuery.data !== null &&
    Array.isArray((optionsQuery.data as { providers?: unknown }).providers)
      ? ((optionsQuery.data as { providers: ProviderOption[] }).providers.filter(
          (p) => p.authenticated && (p.models?.length ?? 0) > 0,
        ))
      : [];
  const selected = providers.find((p) => p.slug === provider);

  return (
    <SettingsPage title="Models">
      <div className="w-full rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Main model</p>
        <p className="mt-1 break-words text-lg font-medium">{info.model}</p>
        <p className="break-words text-sm text-text-secondary">
          Provider: {info.provider}
          {contextK !== null ? ` · context ${contextK}k` : ''}
        </p>
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Switch main model
      </p>
      <div className="space-y-2">
        <select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value);
            setModel('');
          }}
          aria-label="Provider"
          className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
        >
          <option value="">Select provider…</option>
          {providers.map((p) => (
            <option key={p.slug} value={p.slug ?? ''}>
              {p.slug}
            </option>
          ))}
        </select>
        {provider !== '' && selected !== undefined ? (
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label="Model"
            className="h-10 w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
          >
            <option value="">Select model…</option>
            {selected.models?.map((m) => {
              const name = typeof m === 'string' ? m : String((m as { id?: unknown }).id ?? m);
              return (
                <option key={name} value={name}>
                  {name}
                </option>
              );
            })}
          </select>
        ) : null}
        {provider !== '' && model !== '' ? (
          <button
            type="button"
            disabled={assign.isPending}
            onClick={() => apply(needsConfirm !== null)}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 sm:w-auto"
          >
            {assign.isPending
              ? 'Applying…'
              : needsConfirm !== null
                ? 'Confirm and apply'
                : 'Apply'}
          </button>
        ) : null}
        {message !== null ? <p className="text-xs text-text-secondary">{message}</p> : null}
        {needsConfirm !== null ? (
          <p className="text-xs text-warning">
            Pending confirmation for {needsConfirm}. Click Apply again to proceed.
          </p>
        ) : null}
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold tracking-wide text-text-secondary uppercase">
        Provider readiness
      </p>
      {optionsQuery.isError ? (
        <SettingsError message={optionsQuery.error.message} />
      ) : (
        <ProvidersList data={optionsQuery.data} />
      )}
      <p className="mt-4 text-xs text-text-secondary">
        Fallbacks and auxiliary slots: edit via Settings search or Raw Config; a curated editor
        arrives post-RC1.
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
          <span>
            {provider.slug ?? 'unknown'}
            {provider.is_current ? ' · current' : ''}
          </span>
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
