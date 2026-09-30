import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchConfigRaw, putConfigRaw } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/**
 * Raw Config (PRD 31): edit the real config.yaml. The dashboard validates
 * YAML before saving (400 on invalid) and the editor shows a line diff before
 * applying. The saved file IS the Hermes file; no parallel copy (PRD 31.2).
 */

/** Minimal LCS line diff for the pre-apply review (config files are small). */
function lineDiff(original: string, edited: string): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = original.split('\n');
  const b = edited.split('\n');
  // LCS table: O(n*m) cells; config.yaml is a few hundred lines, fine.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'del', text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j]! });
    j += 1;
  }
  return out;
}

export function RawConfigPage() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['config-raw'], queryFn: fetchConfigRaw });

  const original = configQuery.data?.yaml ?? '';
  const [edited, setEdited] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Adjust editor content when a different config loads (React "adjust state
  // during render" pattern; no effect needed, PRD-lint friendly).
  const [prevOriginal, setPrevOriginal] = useState<string | null>(null);
  if (configQuery.data !== undefined && prevOriginal !== original) {
    setPrevOriginal(original);
    setEdited(original);
    setSaved(false);
  }

  const save = useMutation({
    mutationFn: (yamlText: string) => putConfigRaw(yamlText),
    onSuccess: () => {
      setSaved(true);
      setEdited(null);
      // Raw config replaces the whole file; a restart is likely required.
      window.dispatchEvent(new CustomEvent('hermes-webui:restart-required'));
      void queryClient.invalidateQueries({ queryKey: ['config-raw'] });
    },
  });

  const dirty = edited !== null && edited !== original;
  const diff = useMemo(() => (dirty ? lineDiff(original, edited ?? '') : []), [dirty, original, edited]);
  const changedLines = diff.filter((d) => d.kind !== 'same').length;

  if (configQuery.isPending) {
    return (
      <SettingsPage title="Raw Config">
        <p className="text-sm text-text-secondary">Loading config…</p>
      </SettingsPage>
    );
  }
  if (configQuery.isError) {
    return (
      <SettingsPage title="Raw Config">
        <SettingsError message={configQuery.error.message} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="Raw Config">
      <p className="mb-3 text-xs text-text-secondary">
        {configQuery.data.path} — saved directly by Hermes. Invalid YAML is refused before applying
        (PRD 65.6).
      </p>

      {dirty ? (
        <details className="mb-3 rounded-lg border border-border-subtle bg-surface-elevated p-3 text-xs">
          <summary className="cursor-pointer select-none font-medium">
            Review changes ({changedLines} changed lines)
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded bg-surface p-2 font-mono">
            {diff.map((line, index) => (
              <div
                key={index}
                className={
                  line.kind === 'add'
                    ? 'bg-success/10 text-success'
                    : line.kind === 'del'
                      ? 'bg-danger/10 text-danger'
                      : 'text-text-secondary'
                }
              >
                {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
                {line.text}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <textarea
        value={edited ?? ''}
        onChange={(event) => {
          setEdited(event.target.value);
          setSaved(false);
        }}
        spellCheck={false}
        aria-label="Raw config.yaml"
        className="h-[60vh] w-full resize-none rounded-xl border border-border-subtle bg-surface-elevated p-4 font-mono text-xs outline-none focus:border-accent"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(edited ?? '')}
          className="yu-btn yu-btn-primary px-4 py-2 text-sm"
        >
          {save.isPending ? 'Saving…' : 'Save config'}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setEdited(original);
              setSaved(false);
            }}
            className="rounded-xl border border-border-subtle px-4 py-2 text-sm"
          >
            Discard
          </button>
        ) : null}
        {saved ? <span className="text-sm text-success">Saved.</span> : null}
        {save.isError ? <span className="text-sm text-danger">{save.error.message}</span> : null}
      </div>
    </SettingsPage>
  );
}
