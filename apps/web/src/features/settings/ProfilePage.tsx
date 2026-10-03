import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleCheck,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  createProfile,
  deleteProfile,
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
import {
  Badge,
  Card,
  ErrorNote,
  Menu,
  Section,
  Segmented,
  Sheet,
  SkeletonRows,
  StatusDot,
} from '../../components/ui';
import { Markdown } from '../chat/Markdown';
import { SettingsPage } from './SettingsLayout';

type TFunc = ReturnType<typeof useTranslation>['t'];

function SoulEditor({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const soul = useQuery({ queryKey: ['soul', profile], queryFn: () => fetchSoul(profile) });
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? soul.data?.content ?? '';
  const dirty = draft !== null && draft !== (soul.data?.content ?? '');

  const save = useMutation({
    mutationFn: (content: string) => saveSoul(profile, content),
    onSuccess: () => {
      toast(t('settings.profile.soulSaved'), 'success');
      setDraft(null);
      setMode('read');
      void queryClient.invalidateQueries({ queryKey: ['soul', profile] });
    },
    onError: (error) => toastError(error),
  });

  if (soul.isPending) return <SkeletonRows rows={4} />;
  if (soul.isError)
    return <ErrorNote message={soul.error.message} onRetry={() => void soul.refetch()} />;

  return (
    <Section
      title={t('settings.profile.soulSection')}
      description={t('settings.profile.soulDesc')}
      actions={
        <Segmented
          label={t('settings.profile.soulView')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'read', label: t('settings.profile.read') },
            { value: 'edit', label: t('settings.profile.edit') },
          ]}
        />
      }
    >
      <Card className="p-5">
        {mode === 'read' ? (
          text.trim() === '' ? (
            <p className="text-[13px] text-text-tertiary">{t('settings.profile.noSoul')}</p>
          ) : (
            <Markdown text={text} />
          )
        ) : (
          <>
            <textarea
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t('settings.profile.soulAria')}
              spellCheck={false}
              className="yu-input min-h-[22rem] w-full resize-y px-3.5 py-3 font-mono text-[12.5px] leading-relaxed"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              {dirty ? (
                <span className="mr-auto text-xs text-accent">{t('settings.profile.unsaved')}</span>
              ) : null}
              <button
                type="button"
                className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]"
                disabled={!dirty}
                onClick={() => setDraft(null)}
              >
                {t('settings.profile.discard')}
              </button>
              <button
                type="button"
                className="yu-btn yu-btn-primary h-9 px-4 text-[13px]"
                disabled={!dirty || save.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t('settings.profile.saveSoulTitle', { profile }),
                    description: t('settings.profile.saveSoulDesc'),
                    confirmLabel: t('settings.profile.saveSoul'),
                  });
                  if (ok) save.mutate(text);
                }}
              >
                {save.isPending ? t('settings.profile.saving') : t('settings.profile.save')}
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
function profileLabel(profile: ProfileInfo, t: TFunc): string {
  const name = profile.display_name?.trim();
  if (name) return name;
  return profile.is_default ? t('settings.profile.defaultProfile') : profile.name;
}

function hasName(profile: ProfileInfo): boolean {
  return !profile.is_default || (profile.display_name?.trim() ?? '') !== '';
}

/** New profile: empty, or a copy of an existing one. */
function NewProfileSheet({
  source,
  onClose,
  onCreated,
}: {
  source: ProfileInfo;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState<'fresh' | 'settings' | 'all'>('fresh');
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const valid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
  const create = useMutation({
    mutationFn: () =>
      createProfile({
        name: slug,
        description: description.trim() || undefined,
        ...(start === 'fresh' ? {} : { clone_from: source.name, clone_all: start === 'all' }),
      }),
    onSuccess: () => {
      toast(t('settings.profile.created', { name: slug }), 'success');
      onCreated(slug);
    },
    onError: (error) => toastError(error),
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('settings.profile.newProfile')}
      subtitle={t('settings.profile.newProfileSubtitle')}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-text-primary">
            {t('settings.profile.name')}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('settings.profile.namePlaceholder')}
            className="yu-input h-10 w-full px-3 font-mono text-sm"
          />
          <span className="mt-1 block text-xs text-text-tertiary">
            {slug === '' || valid
              ? t('settings.profile.slugHint')
              : t('settings.profile.slugInvalid')}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-text-primary">
            {t('settings.profile.purposeLabel')}
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="yu-input h-10 w-full px-3 text-sm"
          />
        </label>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-text-primary">
            {t('settings.profile.startFrom')}
          </p>
          <Segmented
            label={t('settings.profile.startFrom')}
            value={start}
            onChange={setStart}
            options={[
              { value: 'fresh', label: t('settings.profile.startFresh') },
              {
                value: 'settings',
                label: t('settings.profile.startSettings', { name: profileLabel(source, t) }),
              },
              { value: 'all', label: t('settings.profile.startAll') },
            ]}
          />
          <p className="mt-1.5 text-xs text-text-tertiary">
            {start === 'fresh'
              ? t('settings.profile.freshDesc')
              : start === 'settings'
                ? t('settings.profile.settingsDesc')
                : t('settings.profile.allDesc')}
          </p>
        </div>
        <button
          type="submit"
          disabled={!valid || create.isPending}
          className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
        >
          {create.isPending ? t('settings.profile.creating') : t('settings.profile.createProfile')}
        </button>
      </form>
    </Sheet>
  );
}

/** Profiles (create, rename, describe, delete) and the selected profile's SOUL. */
export function ProfilePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles });
  const active = useQuery({ queryKey: ['active-profile'], queryFn: fetchActiveProfile });
  const [selected, setSelected] = useState<string | null>(null);
  const serving = active.data?.current ?? active.data?.active;
  const current = selected ?? serving ?? 'default';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['profiles'] });
  const [creating, setCreating] = useState(false);

  const remove = async (profile: ProfileInfo) => {
    const typed = await promptDialog({
      title: t('settings.profile.deleteTitle', { name: profileLabel(profile, t) }),
      description: t('settings.profile.deleteDesc', { name: profile.name }),
      placeholder: profile.name,
      confirmLabel: t('settings.profile.deleteProfile'),
    });
    if (typed === null) return;
    if (typed.trim() !== profile.name) {
      toast(t('settings.profile.nameMismatch'), 'error');
      return;
    }
    try {
      const result = await deleteProfile(profile.name);
      toast(
        result.settlement_pending
          ? t('settings.profile.deletedPending', { command: result.retry_command ?? '' })
          : t('settings.profile.deleted', { name: profileLabel(profile, t) }),
        'success',
      );
      if (selected === profile.name) setSelected(null);
      refresh();
    } catch (error) {
      toastError(error);
    }
  };

  const rename = async (profile: ProfileInfo) => {
    const next = await promptDialog({
      title: t('settings.profile.renameTitle', { name: profileLabel(profile, t) }),
      description: profile.is_default
        ? t('settings.profile.renameDefaultDesc')
        : t('settings.profile.renameDesc'),
      initialValue: hasName(profile) ? profileLabel(profile, t) : '',
      confirmLabel: t('settings.profile.rename'),
    });
    if (
      next === null ||
      next.trim() === '' ||
      (hasName(profile) && next.trim() === profileLabel(profile, t))
    )
      return;
    try {
      const result = await renameProfile(profile.name, next.trim());
      toast(
        t('settings.profile.renamedTo', { name: result.display_name ?? result.name }),
        'success',
      );
      if (selected === profile.name && !profile.is_default) setSelected(result.name);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['active-profile'] });
    } catch (error) {
      toastError(error);
    }
  };

  const describe = async (profile: ProfileInfo) => {
    const next = await promptDialog({
      title: t('settings.profile.describeTitle', { name: profileLabel(profile, t) }),
      description: t('settings.profile.describeDesc'),
      initialValue: profile.description,
      confirmLabel: t('settings.profile.save'),
    });
    if (next === null) return;
    try {
      await setProfileDescription(profile.name, next);
      toast(t('settings.profile.descriptionSaved'), 'success');
      refresh();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <SettingsPage
      title={t('settings.profile.title')}
      description={t('settings.profile.description')}
    >
      <Section
        title={t('settings.profile.profiles')}
        description={t('settings.profile.profilesDesc')}
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="yu-btn yu-btn-tonal h-8 gap-1.5 rounded-lg px-3 text-xs"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('settings.profile.newProfile')}
          </button>
        }
      >
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
                    aria-label={t('settings.profile.showSoulAria', {
                      name: profileLabel(profile, t),
                    })}
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
                        {profileLabel(profile, t)}
                        {isServing ? (
                          <Badge tone="accent">{t('settings.profile.thisApp')}</Badge>
                        ) : null}
                        {profile.is_default ? (
                          <Badge>{t('settings.profile.defaultBadge')}</Badge>
                        ) : null}
                        {isCurrent ? (
                          <CircleCheck
                            className="size-3.5 text-accent"
                            aria-label={t('settings.profile.selectedAria')}
                          />
                        ) : null}
                      </span>
                      {profileLabel(profile, t) !== profile.name ? (
                        <span
                          className="block font-mono text-[11px] text-text-tertiary"
                          title={t('settings.profile.idTip')}
                        >
                          {t('settings.profile.idLabel', { name: profile.name })}
                        </span>
                      ) : null}
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-text-secondary">
                        {profile.description !== ''
                          ? profile.description
                          : t('settings.profile.noDescription')}
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
                          {t('settings.profile.nameIt')}
                        </span>
                      ) : null}
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-text-tertiary">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot tone={profile.gateway_running ? 'success' : 'neutral'} />
                          {profile.gateway_running
                            ? t('settings.profile.gatewayUp')
                            : t('settings.profile.gatewayDown')}
                        </span>
                        {profile.model !== null ? <span>{profile.model}</span> : null}
                        <span>
                          {t('settings.profile.skillsCount', { count: profile.skill_count })}
                        </span>
                      </span>
                    </span>
                  </button>
                  <Menu
                    label={t('settings.profile.actionsFor', { name: profileLabel(profile, t) })}
                    trigger={<MoreHorizontal className="size-4" aria-hidden />}
                    items={[
                      {
                        label: t('settings.profile.rename'),
                        icon: <Pencil />,
                        onSelect: () => void rename(profile),
                      },
                      {
                        label: t('settings.profile.editDescription'),
                        icon: <FileText />,
                        onSelect: () => void describe(profile),
                      },
                      ...(profile.is_default || isServing
                        ? []
                        : [
                            {
                              label: t('settings.profile.delete'),
                              icon: <Trash2 />,
                              danger: true,
                              onSelect: () => void remove(profile),
                            },
                          ]),
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <SoulEditor key={current} profile={current} />
      {creating && profiles.data !== undefined ? (
        <NewProfileSheet
          source={
            profiles.data.profiles.find((p) => p.name === current) ?? profiles.data.profiles[0]!
          }
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            setSelected(name);
            refresh();
          }}
        />
      ) : null}
    </SettingsPage>
  );
}
