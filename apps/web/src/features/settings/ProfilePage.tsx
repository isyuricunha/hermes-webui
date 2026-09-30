import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CircleCheck, FileText, MoreHorizontal, Pencil, UserRound } from 'lucide-react';
import {
  fetchActiveProfile,
  fetchProfiles,
  fetchSoul,
  renameProfile,
  saveSoul,
  setProfileDescription,
  type ProfileInfo,
} from '../../lib/hx';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, ErrorNote, Menu, Section, Segmented, SkeletonRows, StatusDot } from '../../components/ui';
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
      toast('SOUL saved. New conversations use it; a running one after /new or /reset.', 'success');
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
                    description:
                      'This rewrites SOUL.md in the profile folder. Hermes reads it when a conversation starts: new chats get it right away, and a conversation already running (Telegram included) only after /new or /reset.',
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

/**
 * Name shown for a profile. In Hermes a profile's name is its folder
 * (~/.hermes/profiles/<name>), read from each install; only the default
 * profile (~/.hermes itself) has no folder name, so it can carry an optional
 * display name and otherwise shows as "Default profile".
 */
function profileLabel(profile: ProfileInfo): string {
  const name = profile.display_name?.trim();
  if (name) return name;
  return profile.is_default ? 'Default profile' : profile.name;
}

function hasName(profile: ProfileInfo): boolean {
  return !profile.is_default || (profile.display_name?.trim() ?? '') !== '';
}

/** Profiles (rename, describe) and the selected profile's SOUL. */
export function ProfilePage() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles });
  const active = useQuery({ queryKey: ['active-profile'], queryFn: fetchActiveProfile });
  const [selected, setSelected] = useState<string | null>(null);
  const serving = active.data?.current ?? active.data?.active;
  const current = selected ?? serving ?? 'default';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['profiles'] });

  const rename = async (profile: ProfileInfo) => {
    const next = await promptDialog({
      title: `Rename ${profileLabel(profile)}`,
      description: profile.is_default
        ? 'The default profile keeps its folder; this only changes the name shown.'
        : 'Renames the profile folder. Its gateway is stopped during the rename, and anything that calls it by the old name (scripts, `hermes -p`) needs the new one.',
      initialValue: hasName(profile) ? profileLabel(profile) : '',
      confirmLabel: 'Rename',
    });
    if (next === null || next.trim() === '' || (hasName(profile) && next.trim() === profileLabel(profile))) return;
    try {
      const result = await renameProfile(profile.name, next.trim());
      toast(`Renamed to ${result.display_name ?? result.name}.`, 'success');
      if (selected === profile.name && !profile.is_default) setSelected(result.name);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['active-profile'] });
    } catch (error) {
      toastError(error);
    }
  };

  const describe = async (profile: ProfileInfo) => {
    const next = await promptDialog({
      title: `Describe ${profileLabel(profile)}`,
      description: 'A short role line (what this profile is for). Hermes uses it to route work between profiles.',
      initialValue: profile.description,
      confirmLabel: 'Save',
    });
    if (next === null) return;
    try {
      await setProfileDescription(profile.name, next);
      toast('Description saved.', 'success');
      refresh();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <SettingsPage title="Profile & SOUL" description="Who Hermes is: its profiles, models and personality.">
      <Section title="Profiles" description="Each profile has its own SOUL, memory, skills and bots. Pick one to read or edit its SOUL.">
        {profiles.isError ? (
          <ErrorNote message={profiles.error.message} />
        ) : profiles.isPending ? (
          <SkeletonRows rows={2} />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {profiles.data.profiles.map((profile) => {
              const isCurrent = profile.name === current;
              const isServing = profile.name === serving;
              return (
                <div
                  key={profile.name}
                  className={[
                    'yu-card yu-lift flex items-start gap-3 rounded-2xl p-4',
                    isCurrent ? '!border-accent/60 ring-1 ring-accent/30' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(profile.name)}
                    aria-pressed={isCurrent}
                    aria-label={`Show SOUL of ${profileLabel(profile)}`}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary">
                      <UserRound className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={[
                          'flex flex-wrap items-center gap-2 text-sm font-medium',
                          hasName(profile) ? 'text-text-primary' : 'text-text-secondary italic',
                        ].join(' ')}
                      >
                        {profileLabel(profile)}
                        {isServing ? <Badge tone="accent">This app</Badge> : null}
                        {profile.is_default ? <Badge>default</Badge> : null}
                        {isCurrent ? <CircleCheck className="size-3.5 text-accent" aria-label="Selected" /> : null}
                      </span>
                      {profileLabel(profile) !== profile.name ? (
                        <span
                          className="block font-mono text-[11px] text-text-tertiary"
                          title="Profile id in Hermes (hermes -p <id>)."
                        >
                          id: {profile.name}
                        </span>
                      ) : null}
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-text-secondary">
                        {profile.description !== '' ? profile.description : 'No description yet.'}
                      </span>
                      {!hasName(profile) ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void rename(profile);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              void rename(profile);
                            }
                          }}
                          className="yu-btn yu-btn-tonal mt-2 inline-flex h-7 rounded-lg px-2.5 text-xs"
                        >
                          <Pencil className="size-3" aria-hidden />
                          Name it
                        </span>
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
                  </button>
                  <Menu
                    label={`Actions for ${profileLabel(profile)}`}
                    trigger={<MoreHorizontal className="size-4" aria-hidden />}
                    items={[
                      { label: 'Rename', icon: <Pencil />, onSelect: () => void rename(profile) },
                      { label: 'Edit description', icon: <FileText />, onSelect: () => void describe(profile) },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <SoulEditor key={current} profile={current} />
    </SettingsPage>
  );
}
