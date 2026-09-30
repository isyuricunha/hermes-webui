import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { editMemoryFile, fetchMemoryFile, type MemoryTarget } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Card, ErrorNote, Segmented, SkeletonRows } from '../../components/ui';

const LABEL: Record<MemoryTarget, { file: string; hint: string }> = {
  memory: { file: 'MEMORY.md', hint: 'Facts, rules and project notes Hermes keeps.' },
  user: { file: 'USER.md', hint: 'What Hermes knows about you.' },
};

function EntryEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Memory entry"
        autoFocus
        className="yu-input min-h-28 w-full resize-y px-3 py-2.5 text-[13px] leading-relaxed"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="yu-btn yu-btn-ghost h-8 gap-1.5 px-3 text-xs">
          <X className="size-3.5" aria-hidden /> Cancel
        </button>
        <button
          type="button"
          disabled={busy || text.trim() === '' || text === initial}
          onClick={() => onSave(text.trim())}
          className="yu-btn yu-btn-primary h-8 gap-1.5 px-3 text-xs"
        >
          <Check className="size-3.5" aria-hidden /> Save
        </button>
      </div>
    </div>
  );
}

/**
 * MEMORY.md / USER.md, entry by entry, edited through Hermes' own memory
 * store (file lock, char limits, the agent's entry format).
 */
export function MemoryFiles() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<MemoryTarget>('memory');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const file = useQuery({ queryKey: ['memory-file', target], queryFn: () => fetchMemoryFile(target) });
  const edit = useMutation({
    mutationFn: (change: Parameters<typeof editMemoryFile>[1]) => editMemoryFile(target, change),
    onSuccess: () => {
      toast(`${LABEL[target].file} updated. New conversations see it (/new or /reset for a running one).`, 'success');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['memory-file', target] });
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
    onError: (error) => toastError(error),
  });

  const pct = file.data !== undefined && file.data.limit > 0 ? Math.min(100, (file.data.chars / file.data.limit) * 100) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="Memory file"
          value={target}
          onChange={(value) => {
            setTarget(value);
            setEditing(null);
          }}
          options={[
            { value: 'memory', label: 'MEMORY.md' },
            { value: 'user', label: 'USER.md' },
          ]}
        />
        <span className="text-xs text-text-tertiary">{LABEL[target].hint}</span>
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={editing === 'new'}
          className="yu-btn yu-btn-tonal ml-auto h-8 gap-1.5 px-3 text-xs"
        >
          <Plus className="size-3.5" aria-hidden /> Add entry
        </button>
      </div>
      {file.isError ? (
        <ErrorNote message={file.error.message} onRetry={() => void file.refetch()} />
      ) : file.isPending ? (
        <SkeletonRows rows={3} />
      ) : (
        <Card>
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {file.data.entries.length} entries · {file.data.chars.toLocaleString()} of {file.data.limit.toLocaleString()} characters
              </span>
              <span className="font-mono">{pct.toFixed(0)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip" aria-hidden>
              <div
                className={['h-full rounded-full', pct > 90 ? 'bg-warning' : 'bg-accent'].join(' ')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {editing === 'new' ? (
            <div className="border-b border-border-subtle px-4 py-3.5">
              <EntryEditor
                initial=""
                busy={edit.isPending}
                onCancel={() => setEditing(null)}
                onSave={(content) => edit.mutate({ action: 'add', content })}
              />
            </div>
          ) : null}
          {file.data.entries.length === 0 && editing !== 'new' ? (
            <p className="px-4 py-4 text-[13px] text-text-secondary">Empty. Hermes adds entries as it learns; you can add one too.</p>
          ) : (
            <ol className="divide-y divide-border-subtle">
              {file.data.entries.map((entry, index) => (
                <li key={`${index}-${entry.slice(0, 24)}`} className="group px-4 py-3.5">
                  {editing === entry ? (
                    <EntryEditor
                      initial={entry}
                      busy={edit.isPending}
                      onCancel={() => setEditing(null)}
                      onSave={(content) => edit.mutate({ action: 'replace', entry, content })}
                    />
                  ) : (
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-text-tertiary">{index + 1}</span>
                      <p className="min-w-0 flex-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-text-primary">{entry}</p>
                      <div className="flex shrink-0 gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="Edit entry"
                          onClick={() => setEditing(entry)}
                          className="yu-btn yu-btn-ghost size-8 rounded-lg"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete entry"
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: 'Delete this entry?',
                              description: `Hermes forgets it from ${LABEL[target].file}. Running conversations keep their copy until /new or /reset.`,
                              confirmLabel: 'Delete',
                              tone: 'danger',
                            });
                            if (ok) edit.mutate({ action: 'remove', entry });
                          }}
                          className="yu-btn yu-btn-ghost size-8 rounded-lg hover:text-danger"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
