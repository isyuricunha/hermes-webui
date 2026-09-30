import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ChevronRight, FileText, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import {
  createSkill,
  deleteSkill,
  fetchSkillContent,
  fetchSkillList,
  saveSkillContent,
  toggleSkill,
  type SkillInfo,
} from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Section, Segmented, SkeletonRows, Sheet, Switch } from '../../components/ui';
import { Markdown } from '../chat/Markdown';
import { SettingsPage } from './SettingsLayout';
import { PendingWrites } from './PendingWrites';

/** Strips YAML front matter so the sheet shows the readable body. */
function body(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

const NEW_SKILL_TEMPLATE = `---
name: my-skill
description: One line on when Hermes should load this skill.
---

# My skill

Steps, rules and examples Hermes follows when this skill applies.
`;

function SkillSheet({
  name,
  creating,
  onClose,
  onChanged,
}: {
  name: string | null;
  creating: boolean;
  onClose: () => void;
  onChanged: (name?: string) => void;
}) {
  const content = useQuery({
    queryKey: ['skill-content', name],
    queryFn: () => fetchSkillContent(name as string),
    enabled: name !== null && !creating,
  });
  const [mode, setMode] = useState<'read' | 'edit'>(creating ? 'edit' : 'read');
  const [draft, setDraft] = useState<string | null>(creating ? NEW_SKILL_TEMPLATE : null);
  const [newName, setNewName] = useState('');
  const [category, setCategory] = useState('');
  const text = draft ?? content.data?.content ?? '';
  const dirty = creating || (draft !== null && draft !== (content.data?.content ?? ''));

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        await createSkill(newName.trim(), text, category.trim() || undefined);
        return newName.trim();
      }
      await saveSkillContent(name as string, text);
      return name as string;
    },
    onSuccess: (saved) => {
      toast(creating ? `Skill ${saved} created.` : `${saved} saved. Conversations load it the next time the skill applies.`, 'success');
      setDraft(null);
      setMode('read');
      onChanged(saved);
    },
    onError: (error) => toastError(error),
  });

  const remove = async () => {
    if (name === null) return;
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      description: 'Hermes removes the skill folder (SKILL.md and its files). Pinned skills are refused. This cannot be undone from here.',
      confirmLabel: 'Delete skill',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSkill(name);
      toast(`${name} deleted.`, 'success');
      onChanged();
      onClose();
    } catch (error) {
      toastError(error);
    }
  };

  const open = name !== null || creating;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={creating ? 'New skill' : (name ?? '')}
      subtitle={creating ? 'Saved to your skills folder' : content.data?.path}
      actions={
        creating ? null : (
          <>
            <Segmented
              label="Skill view"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'read', label: 'Read' },
                { value: 'edit', label: 'Edit' },
              ]}
            />
            <button type="button" aria-label={`Delete ${name ?? 'skill'}`} onClick={() => void remove()} className="yu-btn yu-btn-ghost size-8 rounded-lg hover:text-danger">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </>
        )
      }
    >
      {!creating && content.isPending ? (
        <SkeletonRows rows={5} />
      ) : !creating && content.isError ? (
        <ErrorNote message={content.error.message} />
      ) : mode === 'read' ? (
        <Markdown text={body(text)} />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {creating ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="skill-name"
                aria-label="Skill name"
                className="yu-input h-10 px-3 font-mono text-[13px]"
              />
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="category (optional)"
                aria-label="Category"
                className="yu-input h-10 px-3 text-[13px]"
              />
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="SKILL.md"
            spellCheck={false}
            className="yu-input min-h-[24rem] w-full flex-1 resize-y px-3.5 py-3 font-mono text-[12.5px] leading-relaxed"
          />
          <div className="flex items-center justify-end gap-2">
            {dirty && !creating ? <span className="mr-auto text-xs text-accent">Unsaved changes</span> : null}
            {!creating ? (
              <button type="button" className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]" disabled={!dirty} onClick={() => setDraft(null)}>
                Discard
              </button>
            ) : null}
            <button
              type="button"
              className="yu-btn yu-btn-primary h-9 px-4 text-[13px]"
              disabled={!dirty || save.isPending || (creating && !/^[a-z0-9][a-z0-9._-]*$/i.test(newName.trim()))}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : creating ? 'Create skill' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

type SkillSource = 'all' | 'agent' | 'hub' | 'bundled';

/** Hermes' own provenance: it does not tell skills you wrote from ones the agent wrote. */
const SOURCES: readonly { id: SkillSource; label: string; tip: string }[] = [
  { id: 'all', label: 'All', tip: 'Every installed skill.' },
  { id: 'agent', label: 'Yours', tip: 'Made on this machine, by you or by Hermes itself (Hermes does not tell the two apart).' },
  { id: 'hub', label: 'Community', tip: 'Installed from the Skills Hub.' },
  { id: 'bundled', label: 'Official', tip: 'Ships with Hermes.' },
];

function sourceOf(skill: SkillInfo): SkillSource {
  return skill.provenance === 'hub' || skill.provenance === 'bundled' ? skill.provenance : 'agent';
}

function SourceBadge({ skill }: { skill: SkillInfo }) {
  const source = sourceOf(skill);
  const label = source === 'hub' ? 'Community' : source === 'bundled' ? 'Official' : 'Yours';
  return (
    <span
      className={[
        'yu-chip h-5 rounded-full px-1.5 text-[10.5px] font-normal',
        source === 'agent' ? 'yu-chip-agent' : source === 'bundled' ? 'yu-chip-info' : 'yu-chip-neutral',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

/** Skills: every installed skill, grouped by category, with on/off and the SKILL.md. */
export function SkillsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const skills = useQuery({ queryKey: ['skills-full'], queryFn: fetchSkillList });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => toggleSkill(name, enabled),
    onMutate: async ({ name, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['skills-full'] });
      const previous = queryClient.getQueryData<SkillInfo[]>(['skills-full']);
      queryClient.setQueryData<SkillInfo[]>(['skills-full'], (current) =>
        current?.map((skill) => (skill.name === name ? { ...skill, enabled } : skill)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(['skills-full'], context?.previous);
      toastError(error);
    },
    onSuccess: (_data, { name, enabled }) =>
      toast(`${name} ${enabled ? 'enabled' : 'disabled'}. Applies to new conversations (/new or /reset for a running one).`, 'success'),
  });

  const [source, setSource] = useState<SkillSource>('all');
  const [state, setState] = useState<'all' | 'on' | 'off'>('all');
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => {
    const result: Record<SkillSource, number> = { all: 0, agent: 0, hub: 0, bundled: 0 };
    for (const skill of skills.data ?? []) {
      result.all += 1;
      const key = sourceOf(skill);
      if (key !== 'all') result[key] += 1;
    }
    return result;
  }, [skills.data]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, SkillInfo[]>();
    for (const skill of skills.data ?? []) {
      if (source !== 'all' && sourceOf(skill) !== source) continue;
      if (state === 'on' && !skill.enabled) continue;
      if (state === 'off' && skill.enabled) continue;
      if (needle !== '' && !`${skill.name} ${skill.description} ${skill.category ?? ''}`.toLowerCase().includes(needle)) continue;
      const key = skill.category || 'general';
      map.set(key, [...(map.get(key) ?? []), skill]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skills.data, query, source, state]);

  const total = skills.data?.length ?? 0;
  const enabled = skills.data?.filter((skill) => skill.enabled).length ?? 0;
  const shown = groups.reduce((sum, [, list]) => sum + list.length, 0);
  // Long lists start folded (open a category from its header); searching opens everything.
  const foldByDefault = shown > 30 && query.trim() === '';
  const groupOpen = (category: string) => (query.trim() !== '' ? true : (toggledGroups[category] ?? !foldByDefault));

  return (
    <SettingsPage
      title="Skills"
      description={
        skills.data !== undefined
          ? `${enabled} of ${total} skills enabled. Disabled skills are never loaded into a conversation.`
          : 'Reusable know-how Hermes loads when a task calls for it.'
      }
      actions={
        <button type="button" onClick={() => setCreating(true)} className="yu-btn yu-btn-tonal h-9 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" aria-hidden /> New skill
        </button>
      }
    >
      <Section title="Changes waiting for approval" description="Skill writes Hermes staged for review (skills.write_approval).">
        <PendingWrites subsystem="skills" />
      </Section>
      <div className="mb-6 space-y-3">
        <label className="yu-input flex h-10 items-center gap-2 rounded-xl px-3">
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills by name, description or category"
            aria-label="Filter skills"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where the skill came from">
            {SOURCES.map((option) => {
              const active = source === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-tip={option.tip}
                  data-tip-wide
                  onClick={() => setSource(option.id)}
                  className={[
                    'yu-chip h-8 rounded-full px-3 text-[12px] transition-colors',
                    active ? 'bg-chip text-text-primary ring-1 ring-accent/50' : 'yu-chip-neutral hover:text-text-primary',
                  ].join(' ')}
                >
                  {option.label}
                  <span className="font-mono text-[10.5px] text-text-tertiary">{counts[option.id]}</span>
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <Segmented
            label="Skill state"
            value={state}
            onChange={setState}
            options={[
              { value: 'all', label: 'All' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
        {skills.data !== undefined && (source !== 'all' || state !== 'all' || query.trim() !== '') ? (
          <p className="text-xs text-text-tertiary">
            Showing {shown} of {total}.{' '}
            <button
              type="button"
              className="text-link hover:underline"
              onClick={() => {
                setSource('all');
                setState('all');
                setQuery('');
              }}
            >
              Clear filters
            </button>
          </p>
        ) : null}
      </div>
      {skills.isError ? (
        <ErrorNote message={skills.error.message} onRetry={() => void skills.refetch()} />
      ) : skills.isPending ? (
        <SkeletonRows rows={5} />
      ) : groups.length === 0 ? (
        <EmptyNote icon={<Wand2 className="size-6" />} title={total === 0 ? 'No skills installed' : 'No skills match'} />
      ) : (
        <div className="space-y-2.5">
          {groups.map(([category, list]) => {
            const open = groupOpen(category);
            const on = list.filter((skill) => skill.enabled).length;
            return (
              <Card key={category}>
                <button
                  type="button"
                  onClick={() => setToggledGroups((current) => ({ ...current, [category]: !open }))}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-input"
                >
                  <ChevronRight aria-hidden className={['size-4 shrink-0 text-text-tertiary transition-transform', open ? 'rotate-90' : ''].join(' ')} />
                  <span className="flex-1 text-sm font-medium text-text-primary">
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </span>
                  <span className="font-mono text-[11px] text-text-tertiary">
                    {on} of {list.length} on
                  </span>
                </button>
                {open ? (
                  <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                    {list.map((skill) => (
                      <li key={skill.name} className="flex items-center gap-3 px-4 py-3">
                        <button type="button" onClick={() => setOpen(skill.name)} className="group min-w-0 flex-1 text-left">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                            <span className="truncate group-hover:underline group-hover:underline-offset-4">{skill.name}</span>
                            <SourceBadge skill={skill} />
                            {!skill.enabled ? <Badge>Off</Badge> : null}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[13px] text-text-secondary">{skill.description}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Read ${skill.name}`}
                          title="Read SKILL.md"
                          onClick={() => setOpen(skill.name)}
                          className="yu-btn yu-btn-ghost size-8 rounded-lg"
                        >
                          <FileText className="size-4" aria-hidden />
                        </button>
                        <Switch
                          label={`${skill.name} enabled`}
                          checked={skill.enabled}
                          onChange={(next) => toggle.mutate({ name: skill.name, enabled: next })}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      <SkillSheet
        key={creating ? 'new' : (open ?? 'none')}
        name={creating ? null : open}
        creating={creating}
        onClose={() => {
          setOpen(null);
          setCreating(false);
        }}
        onChanged={(saved) => {
          void queryClient.invalidateQueries({ queryKey: ['skills-full'] });
          if (saved !== undefined) {
            void queryClient.invalidateQueries({ queryKey: ['skill-content', saved] });
            setCreating(false);
            setOpen(saved);
          }
        }}
      />
    </SettingsPage>
  );
}
