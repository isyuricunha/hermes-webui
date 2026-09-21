import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchModelOptions, fetchSessionModel, setSessionModel } from '../../lib/api';

/**
 * Native model picker (Chat UX goal, /model): session-scoped model lock via
 * the gateway session model API. Shows the REAL provider -> model catalog in
 * two steps (pick provider, then model). Global defaults are NOT changed
 * here — the picker links to Settings > Models, so a session action can
 * never silently rewrite global config.
 *
 * Prompt-identity note: the ella/ella-large-5-2 label lives in the agent's
 * own system prompt only. This picker is operator configuration UI and shows
 * real provider/model ids; nothing here is injected into prompt-visible text.
 */

interface ModelPickerProps {
  sessionId: string | undefined;
  onClose: () => void;
}

interface ModelOption {
  provider: string;
  model: string;
}

type ModelOptionsPayload = { options?: unknown };

export function normalizeOptions(payload: ModelOptionsPayload): ModelOption[] {
  const raw = Array.isArray(payload.options) ? payload.options : [];
  return raw
    .map((option): ModelOption | null => {
      if (typeof option === 'string') {
        const [provider = '', model = ''] = option.split('/');
        return { provider, model };
      }
      if (option !== null && typeof option === 'object') {
        const record = option as Record<string, unknown>;
        return {
          provider: String(record.provider ?? ''),
          model: String(record.model ?? record.id ?? ''),
        };
      }
      return null;
    })
    .filter((option): option is ModelOption => option !== null && option.model !== '');
}

export function ModelPicker({ sessionId, onClose }: ModelPickerProps) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState('');

  const optionsQuery = useQuery({
    queryKey: ['model-options'],
    queryFn: () => fetchModelOptions() as Promise<ModelOptionsPayload>,
    staleTime: 5 * 60_000,
  });
  const sessionModelQuery = useQuery({
    queryKey: ['session-model', sessionId],
    queryFn: () => fetchSessionModel(sessionId as string),
    enabled: sessionId !== undefined,
  });

  const options = useMemo(() => normalizeOptions(optionsQuery.data ?? {}), [optionsQuery.data]);
  const providers = useMemo(
    () => [...new Set(options.map((option) => option.provider))].sort(),
    [options],
  );
  const providerModels = useMemo(
    () => (provider === '' ? [] : options.filter((option) => option.provider === provider)),
    [options, provider],
  );
  const current = sessionModelQuery.data?.model ?? null;
  const currentProvider = sessionModelQuery.data?.provider ?? '';

  const lock = useMutation({
    mutationFn: (input: { model: string; provider: string }) =>
      setSessionModel(sessionId as string, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session-model', sessionId] });
      onClose();
    },
  });

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-label="Model picker"
        className="absolute bottom-full left-2 right-2 z-50 mb-1 max-h-80 overflow-y-auto rounded-xl border border-border-subtle bg-surface-elevated p-3 shadow-lg md:left-3 md:right-auto md:w-[26rem]"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Session model</p>
            <p className="text-[10px] text-text-secondary">
              {current !== null
                ? `current lock: ${currentProvider !== '' ? `${currentProvider}/` : ''}${current}`
                : 'no session lock — using global default'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close model picker"
            className="rounded px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {sessionId === undefined ? (
          <p className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-secondary">
            Open a chat first to set a session-scoped model. The global default is managed in
            Settings &gt; Models.
          </p>
        ) : options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-text-secondary">
            {optionsQuery.isPending ? 'Loading models…' : 'Model options unavailable.'}
          </p>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold tracking-wide text-text-secondary uppercase">
                Provider
              </span>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                aria-label="Provider"
                className="h-10 w-full rounded-lg border border-border-subtle bg-surface px-3 text-sm outline-none focus:border-accent"
              >
                <option value="">Select provider…</option>
                {providers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            {provider !== '' ? (
              <ul className="space-y-1">
                {providerModels.map((option) => {
                  const selected = current === option.model;
                  return (
                    <li key={option.model}>
                      <button
                        type="button"
                        disabled={lock.isPending}
                        onClick={() => lock.mutate({ model: option.model, provider: option.provider })}
                        className={[
                          'flex min-h-[44px] w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs',
                          selected ? 'border-accent bg-surface' : 'border-border-subtle hover:bg-surface',
                        ].join(' ')}
                      >
                        <span className="break-all font-mono">{option.model}</span>
                        {selected ? (
                          <span className="shrink-0 font-medium text-accent">current</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        )}

        <p className="mt-2 border-t border-border-subtle pt-2 text-[10px] leading-relaxed text-text-secondary">
          Applies to this chat only. To change the global default for all new sessions, use
          Settings &gt; Models.
          {lock.isError ? (
            <span className="mt-1 block text-danger">
              {lock.error instanceof Error ? lock.error.message : 'Model lock failed.'}
            </span>
          ) : null}
        </p>
      </div>
    </>
  );
}
