import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import {
  fetchMemoryProviderConfig,
  saveMemoryProviderConfig,
  setMemoryProvider,
  setupMemoryProvider,
  type MemoryProviderInfo,
  type SchemaField,
  type SetupResult,
} from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, ErrorNote, Segmented, Sheet, SkeletonRows, Switch } from '../../components/ui';

const APPLIES = 'New conversations use it; a running one after /new or /reset.';

type Values = Record<string, string | boolean>;

function initialValue(field: SchemaField): string | boolean {
  if (field.kind === 'boolean' || field.kind === 'bool') return field.value === true || field.value === 'true';
  if (field.kind === 'secret') return '';
  return field.value === null || field.value === undefined ? '' : String(field.value);
}

function visible(field: SchemaField, values: Values): boolean {
  if (!field.when) return true;
  return Object.entries(field.when).every(([key, expected]) => String(values[key] ?? '') === String(expected));
}

/** Form for a provider's own config schema (text, secret, select, switch, number). */
function SchemaForm({ fields, values, onChange }: { fields: SchemaField[]; values: Values; onChange: (key: string, value: string | boolean) => void }) {
  return (
    <div className="space-y-3.5">
      {fields
        .filter((field) => visible(field, values))
        .map((field) => {
          const id = `mem-${field.key}`;
          const value = values[field.key];
          const isBool = field.kind === 'boolean' || field.kind === 'bool';
          return (
            <div key={field.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-[13px] font-medium text-text-primary">
                  {field.label}
                  {field.required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
                </label>
                {field.kind === 'secret' && field.is_set ? <Badge tone="success">saved</Badge> : null}
              </div>
              {isBool ? (
                <Switch label={field.label} checked={value === true} onChange={(next) => onChange(field.key, next)} />
              ) : field.kind === 'select' && (field.options?.length ?? 0) > 0 && (field.options?.length ?? 0) <= 4 ? (
                <Segmented
                  label={field.label}
                  value={String(value ?? '')}
                  onChange={(next) => onChange(field.key, next)}
                  options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
                />
              ) : field.kind === 'select' ? (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={field.label}>
                  {(field.options ?? []).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={value === option.value}
                      onClick={() => onChange(field.key, option.value)}
                      className={['yu-chip', value === option.value ? 'yu-chip-accent' : ''].join(' ')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  id={id}
                  type={field.kind === 'secret' ? 'password' : field.kind === 'integer' || field.kind === 'number' ? 'number' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={String(value ?? '')}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  placeholder={field.kind === 'secret' && field.is_set ? 'Saved. Type to replace' : (field.placeholder ?? '')}
                  className="yu-input h-10 w-full px-3 font-mono text-[13px]"
                />
              )}
              {field.description || field.url ? (
                <p className="mt-1 text-xs text-text-tertiary">
                  {field.description}{' '}
                  {field.url ? (
                    <a href={field.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-text-secondary hover:underline">
                      Open <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function SetupLog({ result }: { result: SetupResult }) {
  return (
    <div className="space-y-2">
      {result.results.map((step, index) => (
        <details key={index} className="rounded-xl bg-surface-input/50 px-3 py-2 text-xs" open={step.status === 'failed'}>
          <summary className="cursor-pointer select-none">
            <Badge tone={step.status === 'failed' ? 'danger' : step.status === 'missing' ? 'warning' : 'success'}>{step.status.replace(/_/g, ' ')}</Badge>{' '}
            <span className="font-mono text-text-secondary">{step.command || step.name}</span>
          </summary>
          {step.stdout || step.stderr ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-tertiary">{[step.stdout, step.stderr].filter(Boolean).join('\n')}</pre>
          ) : null}
        </details>
      ))}
    </div>
  );
}

/** Configure, install and switch to one memory provider. */
export function MemoryProviderSheet({
  provider,
  active,
  onClose,
}: {
  provider: MemoryProviderInfo;
  active: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['memory-provider', provider.name], queryFn: () => fetchMemoryProviderConfig(provider.name) });
  const [values, setValues] = useState<Values | null>(null);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const fields = config.data?.fields ?? [];
  const current: Values = values ?? Object.fromEntries(fields.map((field) => [field.key, initialValue(field)]));
  const changed = values !== null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['memory'] });
    void queryClient.invalidateQueries({ queryKey: ['memory-provider', provider.name] });
  };
  // Secrets left blank keep the saved value.
  const payload = () => Object.fromEntries(Object.entries(current).filter(([key, value]) => {
    const field = fields.find((f) => f.key === key);
    return !(field?.kind === 'secret' && value === '');
  }));

  const save = useMutation({
    mutationFn: () => saveMemoryProviderConfig(provider.name, payload()),
    onSuccess: () => {
      toast(`${provider.name} saved and now in use. ${APPLIES}`, 'success');
      setValues(null);
      refresh();
    },
    onError: (error) => toastError(error),
  });
  const install = useMutation({
    mutationFn: () => setupMemoryProvider(provider.name, changed ? payload() : {}),
    onSuccess: (result) => {
      setSetupResult(result);
      toast(result.ok ? `${provider.name} installed.` : `${provider.name} setup had errors; see the log.`, result.ok ? 'success' : 'error');
      refresh();
    },
    onError: (error) => toastError(error),
  });
  const activate = useMutation({
    mutationFn: (name: string) => setMemoryProvider(name),
    onSuccess: (_data, name) => {
      toast(name === '' ? `Back to the built-in memory. ${APPLIES}` : `${provider.name} is now the memory provider. ${APPLIES}`, 'success');
      refresh();
    },
    onError: (error) => toastError(error),
  });

  const setup = config.data?.setup;
  const needsInstall = provider.status === 'unavailable' && setup !== undefined && !setup.dependencies_installed;

  return (
    <Sheet open onClose={onClose} title={provider.name} subtitle={active ? 'In use' : provider.status.replace(/_/g, ' ')}>
      <div className="space-y-5">
        <p className="text-[13px] text-text-secondary">{provider.description}</p>
        {config.isError ? (
          <ErrorNote message={config.error.message} onRetry={() => void config.refetch()} />
        ) : config.isPending ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            {needsInstall ? (
              <div className="yu-card space-y-2 rounded-2xl px-4 py-3.5">
                <p className="text-[13px] font-medium text-text-primary">Needs installing first</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-text-secondary">
                  {setup!.pip_dependencies.map((dep) => (
                    <li key={dep} className="font-mono">{dep}</li>
                  ))}
                  {setup!.external_dependencies.map((dep) => (
                    <li key={dep.name}>
                      {dep.name}: <code className="font-mono">{dep.install}</code>
                    </li>
                  ))}
                  {setup!.pip_dependencies.length === 0 && setup!.external_dependencies.length === 0 ? <li>Its Python packages</li> : null}
                </ul>
                <button
                  type="button"
                  disabled={install.isPending}
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `Install ${provider.name}?`,
                      description: 'Hermes runs the install steps listed above on the server. It can take a few minutes.',
                      confirmLabel: 'Install',
                    });
                    if (ok) install.mutate();
                  }}
                  className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
                >
                  {install.isPending ? 'Installing…' : 'Install'}
                </button>
              </div>
            ) : null}
            {setupResult !== null ? <SetupLog result={setupResult} /> : null}
            {fields.length > 0 ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate();
                }}
              >
                <SchemaForm fields={fields} values={current} onChange={(key, value) => setValues({ ...current, [key]: value })} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={save.isPending || needsInstall} className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]">
                    {save.isPending ? 'Saving…' : active ? 'Save' : 'Save and use'}
                  </button>
                </div>
              </form>
            ) : provider.status === 'ready' && !active ? null : fields.length === 0 && !needsInstall ? (
              <p className="text-[13px] text-text-tertiary">No settings to fill in.</p>
            ) : null}
            {provider.status === 'ready' && !active && !changed ? (
              <button
                type="button"
                disabled={activate.isPending}
                onClick={() => activate.mutate(provider.name)}
                className="yu-btn yu-btn-tonal h-9 rounded-xl px-4 text-[13px]"
              >
                Use {provider.name} as memory
              </button>
            ) : null}
            {active ? (
              <button
                type="button"
                disabled={activate.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Switch back to the built-in memory?',
                    description: `Hermes stops using ${provider.name}. What it stored there stays there; the built-in MEMORY.md and USER.md take over.`,
                    confirmLabel: 'Switch',
                  });
                  if (ok) activate.mutate('');
                }}
                className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px] text-text-secondary"
              >
                Stop using it (built-in memory only)
              </button>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
