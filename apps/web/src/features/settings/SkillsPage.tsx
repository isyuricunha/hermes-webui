import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FileText, Search, Wand2 } from 'lucide-react';
import { fetchSkillContent, fetchSkillList, toggleSkill, type SkillInfo } from '../../lib/hx';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Section, SkeletonRows, Sheet, Switch } from '../../components/ui';
import { Markdown } from '../chat/Markdown';
import { SettingsPage } from './SettingsLayout';

/** Strips YAML front matter so the sheet shows the readable body. */
function body(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

function SkillSheet({ name, onClose }: { name: string | null; onClose: () => void }) {
  const content = useQuery({
    queryKey: ['skill-content', name],
    queryFn: () => fetchSkillContent(name as string),
    enabled: name !== null,
  });
  return (
    <Sheet open={name !== null} onClose={onClose} title={name ?? ''} subtitle={content.data?.path}>
      {content.isPending ? (
        <SkeletonRows rows={5} />
      ) : content.isError ? (
        <ErrorNote message={content.error.message} />
      ) : (
        <Markdown text={body(content.data.content)} />
      )}
    </Sheet>
  );
}

/** Skills: every installed skill, grouped by category, with on/off and the SKILL.md. */
export function SkillsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
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
    onSuccess: (_data, { name, enabled }) => toast(`${name} ${enabled ? 'enabled' : 'disabled'}.`, 'success'),
  });

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, SkillInfo[]>();
    for (const skill of skills.data ?? []) {
      if (needle !== '' && !`${skill.name} ${skill.description} ${skill.category}`.toLowerCase().includes(needle)) continue;
      const key = skill.category || 'general';
      map.set(key, [...(map.get(key) ?? []), skill]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skills.data, query]);

  const total = skills.data?.length ?? 0;
  const enabled = skills.data?.filter((skill) => skill.enabled).length ?? 0;

  return (
    <SettingsPage
      title="Skills"
      description={
        skills.data !== undefined
          ? `${enabled} of ${total} skills enabled. Disabled skills are never loaded into a conversation.`
          : 'Reusable know-how Hermes loads when a task calls for it.'
      }
    >
      <label className="yu-input mb-6 flex h-10 items-center gap-2 rounded-xl px-3">
        <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter skills"
          aria-label="Filter skills"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
        />
      </label>
      {skills.isError ? (
        <ErrorNote message={skills.error.message} onRetry={() => void skills.refetch()} />
      ) : skills.isPending ? (
        <SkeletonRows rows={5} />
      ) : groups.length === 0 ? (
        <EmptyNote icon={<Wand2 className="size-6" />} title={total === 0 ? 'No skills installed' : 'No skills match'} />
      ) : (
        groups.map(([category, list]) => (
          <Section key={category} title={category.charAt(0).toUpperCase() + category.slice(1)}>
            <Card>
              <ul className="divide-y divide-border-subtle">
                {list.map((skill) => (
                  <li key={skill.name} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen(skill.name)}
                      className="group min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <span className="truncate group-hover:underline group-hover:underline-offset-4">{skill.name}</span>
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
            </Card>
          </Section>
        ))
      )}
      <SkillSheet name={open} onClose={() => setOpen(null)} />
    </SettingsPage>
  );
}
