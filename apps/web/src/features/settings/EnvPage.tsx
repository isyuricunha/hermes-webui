import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyRound, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { deleteEnv, fetchEnv, putEnv } from '../../lib/api';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Card, ErrorNote, Segmented, SkeletonRows } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const RESTART_NOTE = 'New conversations read it; the gateway (Telegram, cron) picks it up after a restart in Settings > System.';

function ValueForm({
  name,
  busy,
  onSave,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className="mt-2.5 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== '') onSave(value);
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        type="password"
        autoComplete="off"
        autoFocus
        aria-label={`New value for ${name}`}
        placeholder="New value (the current one is never shown)"
        className="yu-input h-9 min-w-0 flex-1 px-3 font-mono text-[13px]"
      />
      <button type="button" onClick={onCancel} aria-label="Cancel" className="yu-btn yu-btn-ghost size-9 rounded-lg">
        <X className="size-4" aria-hidden />
      </button>
      <button type="submit" disabled={busy || value === ''} className="yu-btn yu-btn-primary h-9 px-3.5 text-[13px]">
        Save
      </button>
    </form>
  );
}

/**
 * Environment / secrets (PRD 32). The dashboard only ever returns masked
 * values; editing means typing a new value, removing asks first.
 */
export function EnvPage() {
  const queryClient = useQueryClient();
  const envQuery = useQuery({ queryKey: ['env'], queryFn: fetchEnv });
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState<'set' | 'all'>('set');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['env'] });
  const setVar = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => putEnv(key, value),
    onSuccess: (_data, { key }) => {
      toast(`${key} saved. ${RESTART_NOTE}`, 'success', { durationMs: 7000 });
      setEditing(null);
      setAdding(false);
      setNewKey('');
      invalidate();
    },
    onError: (error) => toastError(error),
  });
  const removeVar = useMutation({
    mutationFn: (key: string) => deleteEnv(key),
    onSuccess: (_data, key) => {
      toast(`${key} removed.`, 'success');
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const all = Object.entries(envQuery.data ?? {});
  const needle = filter.trim().toLowerCase();
  const filtered = all
    .filter(([, info]) => (show === 'set' ? info.is_set : true))
    .filter(([name, info]) => `${name} ${info.description ?? ''}`.toLowerCase().includes(needle));

  return (
    <SettingsPage
      title="Environment"
      description="API keys and settings in Hermes' .env. Values are always masked; to change one, type the new value."
      actions={
        <button type="button" onClick={() => setAdding(true)} className="yu-btn yu-btn-tonal h-9 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" aria-hidden /> Add variable
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="yu-input flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3">
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter variables"
            aria-label="Filter environment variables"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
        </label>
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'set', label: 'Set' },
            { value: 'all', label: 'All known' },
          ]}
        />
      </div>

      {adding ? (
        <Card className="mb-4 p-4">
          <p className="mb-2 text-sm font-medium text-text-primary">New variable</p>
          <input
            value={newKey}
            onChange={(event) => setNewKey(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            placeholder="VARIABLE_NAME"
            aria-label="Variable name"
            className="yu-input h-9 w-full px-3 font-mono text-[13px]"
          />
          {newKey.trim() !== '' ? (
            <ValueForm
              name={newKey}
              busy={setVar.isPending}
              onCancel={() => {
                setAdding(false);
                setNewKey('');
              }}
              onSave={(value) => setVar.mutate({ key: newKey.trim(), value })}
            />
          ) : (
            <div className="mt-2.5 flex justify-end">
              <button type="button" onClick={() => setAdding(false)} className="yu-btn yu-btn-ghost h-8 px-3 text-xs">
                Cancel
              </button>
            </div>
          )}
        </Card>
      ) : null}

      {envQuery.isError ? (
        <ErrorNote message={envQuery.error.message} onRetry={() => void envQuery.refetch()} />
      ) : envQuery.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <Card>
          <ul className="divide-y divide-border-subtle">
            {filtered.map(([name, info]) => (
              <li key={name} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <KeyRound className={['size-4 shrink-0', info.is_set ? 'text-success' : 'text-text-tertiary'].join(' ')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px] text-text-primary">{name}</p>
                    <p className="truncate text-[11.5px] text-text-tertiary">
                      {info.is_set ? (info.redacted_value ?? 'set') : 'not set'}
                      {info.description ? ` · ${info.description}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(editing === name ? null : name)}
                    className="yu-btn yu-btn-ghost h-8 gap-1.5 px-2.5 text-xs"
                  >
                    <Pencil className="size-3.5" aria-hidden /> {info.is_set ? 'Change' : 'Set'}
                  </button>
                  {info.is_set ? (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Remove ${name}?`,
                          description: 'The variable is deleted from the Hermes .env. Anything that needs it stops working until it is set again.',
                          confirmLabel: 'Remove',
                          tone: 'danger',
                        });
                        if (ok) removeVar.mutate(name);
                      }}
                      className="yu-btn yu-btn-ghost size-8 rounded-lg hover:text-danger"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {editing === name ? (
                  <ValueForm name={name} busy={setVar.isPending} onCancel={() => setEditing(null)} onSave={(value) => setVar.mutate({ key: name, value })} />
                ) : null}
              </li>
            ))}
            {filtered.length === 0 ? <li className="px-4 py-4 text-[13px] text-text-secondary">No variables match.</li> : null}
          </ul>
        </Card>
      )}
    </SettingsPage>
  );
}
