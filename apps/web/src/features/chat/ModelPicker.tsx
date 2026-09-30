import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles, X } from 'lucide-react';
import { fetchModelOptions, fetchSessionModel, setSessionModel } from '../../lib/api';
import { normalizeCatalog, pickableProviders } from '../../lib/modelCatalog';
import { toast } from '../../lib/toast';
import { ModelBrowser } from '../../components/ModelBrowser';

/**
 * Native model picker (Chat UX goal, /model): session-scoped model lock via
 * the gateway session model API, over the real provider -> model catalog.
 * Global defaults are NOT changed here; the footer links to Settings >
 * Models, so a session action can never silently rewrite global config.
 */

interface ModelPickerProps {
  sessionId: string | undefined;
  onClose: () => void;
}

export function ModelPicker({ sessionId, onClose }: ModelPickerProps) {
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: ['model-options'], queryFn: fetchModelOptions, staleTime: 5 * 60_000 });
  const sessionModelQuery = useQuery({
    queryKey: ['session-model', sessionId],
    queryFn: () => fetchSessionModel(sessionId as string),
    enabled: sessionId !== undefined,
  });
  const providers = useMemo(() => pickableProviders(normalizeCatalog(optionsQuery.data)), [optionsQuery.data]);
  const current = sessionModelQuery.data?.model ?? null;
  const currentProvider = sessionModelQuery.data?.provider ?? '';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lock = useMutation({
    mutationFn: (input: { model: string; provider: string }) => setSessionModel(sessionId as string, input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['session-model', sessionId] });
      toast(`This chat now uses ${input.model}.`, 'success');
      onClose();
    },
  });

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-label="Model picker"
        className="yu-pop yu-pop-in absolute right-2 bottom-full left-2 z-50 mb-2 flex max-h-[min(30rem,70dvh)] flex-col rounded-2xl p-3 md:right-auto md:left-3 md:w-[28rem]"
      >
        <div className="mb-2.5 flex items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-accent">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">Model for this chat</p>
            <p className="truncate text-xs text-text-tertiary">
              {current !== null ? `Locked to ${currentProvider !== '' ? `${currentProvider} / ` : ''}${current}` : 'Using the global default'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close model picker" className="yu-btn yu-btn-ghost size-8 rounded-lg">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {sessionId === undefined ? (
          <p className="rounded-xl bg-surface-input px-3 py-2.5 text-xs text-text-secondary">
            Send the first message, then pick a model for this conversation. The default for every new chat lives in Settings &gt; Models.
          </p>
        ) : optionsQuery.isPending ? (
          <div className="space-y-2 py-1">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="yu-skel h-8 rounded-lg" />
            ))}
          </div>
        ) : providers.length === 0 ? (
          <p className="rounded-xl bg-surface-input px-3 py-2.5 text-xs text-text-secondary">
            {optionsQuery.isError
              ? `Could not load the model list: ${optionsQuery.error.message}`
              : 'No provider with credentials and models. Add a provider key in Settings > Environment.'}
          </p>
        ) : (
          <ModelBrowser
            providers={providers}
            selected={current !== null ? { provider: currentProvider, model: current } : null}
            busy={lock.isPending}
            onPick={(provider, model) => lock.mutate({ provider, model })}
          />
        )}

        {lock.isError ? (
          <p className="mt-2 text-xs text-danger">{lock.error instanceof Error ? lock.error.message : 'Model lock failed.'}</p>
        ) : null}
        <p className="mt-2.5 border-t border-border-subtle pt-2.5 text-[11px] leading-relaxed text-text-tertiary">
          Applies to this chat only. The default for new chats is in{' '}
          <Link to="/settings/models" className="text-accent hover:underline" onClick={onClose}>
            Settings &gt; Models
          </Link>
          .
        </p>
      </div>
    </>
  );
}
