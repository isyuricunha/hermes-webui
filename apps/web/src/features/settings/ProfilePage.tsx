import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Eye, Pencil, UserRound } from 'lucide-react';
import { fetchActiveProfile, fetchProfiles, fetchSoul, saveSoul } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, ErrorNote, Section, Segmented, SkeletonRows, StatusDot } from '../../components/ui';
import { Markdown } from '../chat/Markdown';
import { SettingsPage } from './SettingsLayout';

function SoulEditor({ profile }: { profile: string }) {
  const queryClient = useQueryClient();
  const soul = useQuery({ queryKey: ['soul', profile], queryFn: () => fetchSoul(profile) });
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? soul.data?.content ?? '';
  const dirty = draft !== null && draft !== (soul.data?.content ?? '');

  const save = useMutation({
    mutationFn: (content: string) => saveSoul(profile, content),
    onSuccess: () => {
      toast('SOUL saved. New conversations use it right away.', 'success');
      setDraft(null);
      setMode('read');
      void queryClient.invalidateQueries({ queryKey: ['soul', profile] });
    },
    onError: (error) => toastError(error),
  });

  if (soul.isPending) return <SkeletonRows rows={4} />;
  if (soul.isError) return <ErrorNote message={soul.error.message} onRetry={() => void soul.refetch()} />;

  return (
    <Section
      title="SOUL.md"
      description="The personality and standing rules every conversation starts from."
      actions={
        <Segmented
          label="SOUL view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'read', label: 'Read' },
            { value: 'edit', label: 'Edit' },
          ]}
        />
      }
    >
      <Card className="p-5">
        {mode === 'read' ? (
          text.trim() === '' ? (
            <p className="text-[13px] text-text-tertiary">No SOUL.md yet. Switch to Edit to write one.</p>
          ) : (
            <Markdown text={text} />
          )
        ) : (
          <>
            <textarea
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="SOUL.md"
              spellCheck={false}
              className="yu-input min-h-[22rem] w-full resize-y px-3.5 py-3 font-mono text-[12.5px] leading-relaxed"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              {dirty ? <span className="mr-auto text-xs text-accent">Unsaved changes</span> : null}
              <button
                type="button"
                className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]"
                disabled={!dirty}
                onClick={() => setDraft(null)}
              >
                Discard
              </button>
              <button
                type="button"
                className="yu-btn yu-btn-primary h-9 px-4 text-[13px]"
                disabled={!dirty || save.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Save SOUL for ${profile}?`,
                    description: 'This rewrites SOUL.md in the profile folder. Hermes reads it at the start of every conversation.',
                    confirmLabel: 'Save SOUL',
                  });
                  if (ok) save.mutate(text);
                }}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}

/** Profiles and the active profile's SOUL. */
export function ProfilePage() {
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles });
  const active = useQuery({ queryKey: ['active-profile'], queryFn: fetchActiveProfile });
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? active.data?.current ?? active.data?.active ?? 'default';

  return (
    <SettingsPage title="Profile & SOUL" description="Who Hermes is: its profiles, models and personality.">
      <Section title="Profiles" description="Each profile has its own SOUL, memory, skills and bots.">
        {profiles.isError ? (
          <ErrorNote message={profiles.error.message} />
        ) : profiles.isPending ? (
          <SkeletonRows rows={2} />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {profiles.data.profiles.map((profile) => {
              const isCurrent = profile.name === current;
              const isServing = profile.name === (active.data?.current ?? active.data?.active);
              return (
                <button
                  key={profile.name}
                  type="button"
                  onClick={() => setSelected(profile.name)}
                  aria-pressed={isCurrent}
                  className={[
                    'yu-card yu-lift flex items-start gap-3 rounded-2xl p-4 text-left',
                    isCurrent ? '!border-accent/60' : '',
                  ].join(' ')}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary">
                    <UserRound className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                      {profile.display_name ?? profile.name}
                      {isServing ? <Badge tone="accent">This app</Badge> : null}
                      {profile.is_default ? <Badge>default</Badge> : null}
                    </span>
                    {profile.description !== '' ? (
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-text-secondary">{profile.description}</span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-text-tertiary">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={profile.gateway_running ? 'success' : 'neutral'} />
                        {profile.gateway_running ? 'gateway up' : 'gateway down'}
                      </span>
                      {profile.model !== null ? <span>{profile.model}</span> : null}
                      <span>{profile.skill_count} skills</span>
                    </span>
                  </span>
                  {isCurrent ? <Pencil className="size-4 text-accent" aria-label="Selected" /> : <Eye className="size-4 text-text-tertiary" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
      </Section>
      <SoulEditor key={current} profile={current} />
    </SettingsPage>
  );
}
