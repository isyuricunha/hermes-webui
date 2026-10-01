import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check } from 'lucide-react';
import {
  fetchToolsetConfig,
  fetchToolsetModels,
  saveToolsetEnv,
  selectToolsetModel,
  selectToolsetProvider,
  type ToolsetInfo,
  type ToolsetProviderRow,
} from '../../lib/hx';
import { toast, toastError } from '../../lib/toast';
import { Badge, ErrorNote, Section, Segmented, Sheet, SkeletonRows } from '../../components/ui';

const NEXT_CHAT = 'New conversations use it (/new or /reset for a running one).';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  ready: { label: 'Ready', tone: 'success' },
  needs_keys: { label: 'Needs a key', tone: 'warning' },
  needs_auth: { label: 'Needs Nous login', tone: 'neutral' },
  needs_install: { label: 'Installs on use', tone: 'warning' },
};

/**
 * Setup for one toolset: which provider backs it (web search, image
 * generation, browser...), that provider's API keys and, when it has one,
 * the model. Same choices and config keys as `hermes tools`.
 */
export function ToolsetSheet({ toolset, onClose }: { toolset: ToolsetInfo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['toolset-config', toolset.name], queryFn: () => fetchToolsetConfig(toolset.name) });
  const models = useQuery({ queryKey: ['toolset-models', toolset.name], queryFn: () => fetchToolsetModels(toolset.name) });
  const [open, setOpen] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['toolset-config', toolset.name] });
    void queryClient.invalidateQueries({ queryKey: ['toolset-models', toolset.name] });
    void queryClient.invalidateQueries({ queryKey: ['toolsets'] });
  };

  const pickModel = useMutation({
    mutationFn: (model: string) => selectToolsetModel(toolset.name, model),
    onSuccess: (_data, model) => {
      toast(`${toolset.label} now uses ${model}. ${NEXT_CHAT}`, 'success');
      refresh();
    },
    onError: (error) => toastError(error),
  });

  const data = config.data;
  const expanded = open ?? data?.active_provider ?? null;

  return (
    <Sheet open onClose={onClose} title={`${toolset.label} setup`} subtitle={toolset.description}>
      {config.isError ? (
        <ErrorNote message={config.error.message} onRetry={() => void config.refetch()} />
      ) : config.isPending ? (
        <SkeletonRows rows={4} />
      ) : !data!.has_category || data!.providers.length === 0 ? (
        <p className="text-[13px] text-text-secondary">Nothing to set up here: this toolset only has the on/off switch.</p>
      ) : (
        <div className="space-y-6">
          {toolset.name === 'web' && (data!.active_search_backend || data!.active_extract_backend) ? (
            <p className="text-[13px] text-text-secondary">
              Search runs on <b className="font-medium text-text-primary">{data!.active_search_backend ?? 'none'}</b>, page
              extraction on <b className="font-medium text-text-primary">{data!.active_extract_backend ?? 'none'}</b>.
            </p>
          ) : null}
          <Section title="Provider" description="Pick who does the work. Keys are saved to Hermes' .env and never shown again.">
            <ul className="space-y-2">
              {data!.providers.map((provider) => (
                <li key={provider.name}>
                  <ProviderCard
                    toolset={toolset}
                    provider={provider}
                    expanded={expanded === provider.name}
                    onToggle={() => setOpen(expanded === provider.name ? '' : provider.name)}
                    onSaved={refresh}
                  />
                </li>
              ))}
            </ul>
          </Section>
          {models.data?.has_models ? (
            <Section title="Model" description={`Used by ${models.data.provider ?? 'the active provider'}.`}>
              <ul className="yu-card divide-y divide-border-subtle rounded-2xl">
                {models.data.models.map((model) => {
                  const current = model.id === models.data.current;
                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        disabled={current || pickModel.isPending}
                        onClick={() => pickModel.mutate(model.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover disabled:cursor-default"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-text-primary">{model.display}</span>
                          <span className="block font-mono text-[11px] text-text-tertiary">
                            {[model.id, model.speed, model.price].filter((part) => part !== '').join(' · ')}
                          </span>
                          {model.strengths ? <span className="mt-0.5 block text-xs text-text-secondary">{model.strengths}</span> : null}
                        </span>
                        {current ? <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-label="Current model" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function ProviderCard({
  toolset,
  provider,
  expanded,
  onToggle,
  onSaved,
}: {
  toolset: ToolsetInfo;
  provider: ToolsetProviderRow;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const capabilities = provider.capabilities ?? [];
  const perCapability = toolset.name === 'web' && capabilities.length > 0;
  const [capability, setCapability] = useState<'both' | 'search' | 'extract'>(
    perCapability && capabilities.length === 1 ? (capabilities[0] as 'search' | 'extract') : 'both',
  );
  const status = STATUS[provider.status] ?? { label: provider.status.replace(/_/g, ' '), tone: 'neutral' as const };
  const edited = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
  const missingKey = provider.env_vars.some((env) => !env.is_set && (values[env.key] ?? '').trim() === '' && !/optional/i.test(env.prompt));

  const use = useMutation({
    mutationFn: async (select: boolean) => {
      if (Object.keys(edited).length > 0) await saveToolsetEnv(toolset.name, edited);
      if (select) await selectToolsetProvider(toolset.name, provider.name, perCapability && capability !== 'both' ? capability : undefined);
      return select;
    },
    onSuccess: (select) => {
      setValues({});
      toast(select ? `${toolset.label} now uses ${provider.name}. ${NEXT_CHAT}` : 'Keys saved.', 'success');
      onSaved();
    },
    onError: (error) => toastError(error),
  });

  return (
    <div className={['yu-card rounded-2xl', provider.is_active ? '!border-accent/60 ring-1 ring-accent/30' : ''].join(' ')}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-primary">
            {provider.name}
            {provider.is_active ? <Badge tone="accent">In use</Badge> : null}
            {provider.badge ? <Badge>{provider.badge}</Badge> : null}
          </span>
          {provider.tag ? <span className="mt-0.5 block text-xs text-text-secondary">{provider.tag}</span> : null}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </button>
      {expanded ? (
        <div className="space-y-3 border-t border-border-subtle px-4 py-3.5">
          {provider.requires_nous_auth && provider.status === 'needs_auth' ? (
            <p className="text-xs text-text-secondary">
              Billed to a Nous Portal subscription. Log in once with <code className="font-mono">hermes portal</code> on the
              server, then pick it here.
            </p>
          ) : null}
          {provider.env_vars.map((env) => (
            <label key={env.key} className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2 text-[13px] text-text-primary">
                <span>{env.prompt}</span>
                {env.is_set ? <Badge tone="success">saved</Badge> : null}
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={values[env.key] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [env.key]: event.target.value }))}
                placeholder={env.is_set ? 'Saved. Type to replace' : (env.default ?? '')}
                className="yu-input h-10 w-full px-3 font-mono text-[13px]"
              />
              <span className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
                {env.key}
                {env.url ? (
                  <a href={env.url} target="_blank" rel="noreferrer" className="inline-flex items-center font-sans text-text-secondary hover:underline">
                    Get a key <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ) : null}
              </span>
            </label>
          ))}
          {provider.post_setup ? (
            <p className="text-xs text-text-tertiary">Hermes installs what it needs the first time you turn this on.</p>
          ) : null}
          {perCapability && capabilities.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-secondary">Use it for</span>
              <Segmented
                label="Web capability"
                value={capability}
                onChange={setCapability}
                options={[
                  { value: 'both', label: 'Search and extract' },
                  { value: 'search', label: 'Search' },
                  { value: 'extract', label: 'Extract' },
                ]}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={use.isPending || missingKey || (provider.requires_nous_auth && provider.status === 'needs_auth')}
              onClick={() => use.mutate(true)}
              className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            >
              {use.isPending ? 'Saving…' : provider.is_active && Object.keys(edited).length === 0 ? 'Use again' : `Use ${provider.name}`}
            </button>
            {Object.keys(edited).length > 0 ? (
              <button type="button" disabled={use.isPending} onClick={() => use.mutate(false)} className="yu-btn yu-btn-tonal h-9 rounded-xl px-3.5 text-[13px]">
                Save keys only
              </button>
            ) : null}
          </div>
          {missingKey ? <p className="text-xs text-warning">Add the key above to use this provider.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
