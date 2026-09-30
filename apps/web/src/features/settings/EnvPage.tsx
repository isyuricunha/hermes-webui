import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { deleteEnv, fetchEnv, putEnv } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/**
 * Environment / secrets (PRD 32). Values are only ever shown masked by the
 * dashboard; the WebUI never displays a secret value and requires explicit
 * confirmation before removing a key.
 */
export function EnvPage() {
  const queryClient = useQueryClient();
  const envQuery = useQuery({ queryKey: ['env'], queryFn: fetchEnv });
  const [filter, setFilter] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['env'] });
  };

  const setVar = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => putEnv(key, value),
    onSuccess: (_data, variables) => {
      setMessage(`${variables.key} saved.`);
      setNewKey('');
      setNewValue('');
      invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const removeVar = useMutation({
    mutationFn: (key: string) => deleteEnv(key),
    onSuccess: (_data, key) => {
      setMessage(`${key} removed.`);
      invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  if (envQuery.isPending) {
    return (
      <SettingsPage title="Environment">
        <p className="text-sm text-text-secondary">Loading environment…</p>
      </SettingsPage>
    );
  }
  if (envQuery.isError) {
    return (
      <SettingsPage title="Environment">
        <SettingsError message={envQuery.error.message} />
      </SettingsPage>
    );
  }

  const all = Object.entries(envQuery.data);
  const filtered = all
    .filter(([, info]) => (onlySet ? info.is_set : true))
    .filter(([name]) => name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <SettingsPage title="Environment">
      <p className="mb-3 text-xs text-text-secondary">
        Secrets live in Hermes' .env and are always shown masked. Values never leave the server
        unmasked (PRD 32).
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter variables…"
          aria-label="Filter environment variables"
          className="h-9 flex-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input type="checkbox" checked={onlySet} onChange={(event) => setOnlySet(event.target.checked)} />
          only set
        </label>
      </div>

      <form
        className="mb-4 flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-elevated p-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (newKey.trim() !== '' && newValue !== '') {
            setVar.mutate({ key: newKey.trim(), value: newValue });
          }
        }}
      >
        <input
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
          placeholder="VARIABLE_NAME"
          aria-label="Variable name"
          className="h-9 w-full rounded-lg border border-border-subtle bg-surface px-3 font-mono text-xs outline-none focus:border-accent sm:w-56"
        />
        <input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          placeholder="value"
          aria-label="Variable value"
          type="password"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={newKey.trim() === '' || newValue === '' || setVar.isPending}
          className="yu-btn yu-btn-primary h-9 px-3 text-sm"
        >
          Save
        </button>
      </form>

      {message ? <p className="mb-3 text-xs text-text-secondary">{message}</p> : null}

      <ul className="space-y-1.5">
        {filtered.map(([name, info]) => (
          <li
            key={name}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-medium">{name}</p>
              <p className="truncate text-[11px] text-text-secondary">
                {info.description ?? (info.is_set ? 'set' : 'not set')}
                {info.is_set && info.redacted_value ? ` · ${info.redacted_value}` : ''}
              </p>
            </div>
            {info.is_set ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove ${name} from Hermes .env?`)) {
                    removeVar.mutate(name);
                  }
                }}
                className="shrink-0 rounded-lg border border-danger px-2 py-1 text-[11px] text-danger"
              >
                Remove
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-text-secondary">not set</span>
            )}
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-1 py-2 text-sm text-text-secondary">No variables match.</li>
        ) : null}
      </ul>
    </SettingsPage>
  );
}
