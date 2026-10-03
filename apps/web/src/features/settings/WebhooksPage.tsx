import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Plus, Power, Trash2, Webhook } from 'lucide-react';
import {
  createWebhook,
  deleteWebhook,
  enableWebhooks,
  fetchCronTargets,
  fetchWebhooks,
  setWebhookEnabled,
  type WebhookRoute,
} from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { copyText } from '../../lib/clipboard';
import { relativeTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import {
  Badge,
  Card,
  EmptyNote,
  ErrorNote,
  Menu,
  Sheet,
  SkeletonRows,
  Switch,
} from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

type WebhooksData = Awaited<ReturnType<typeof fetchWebhooks>>;

function copy(text: string, what: string, copiedTemplate: string, failedLabel: string) {
  void copyText(text).then(
    () => toast(copiedTemplate.replace('{{what}}', what), 'success'),
    () => toast(failedLabel, 'error'),
  );
}

const splitList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

/** New webhook: a URL other services call, which wakes Hermes with a prompt. */
function NewWebhookSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const targets = useQuery({ queryKey: ['cron-targets'], queryFn: fetchCronTargets });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState('');
  const [prompt, setPrompt] = useState('');
  const [skills, setSkills] = useState('');
  const [deliver, setDeliver] = useState('log');
  const [chatId, setChatId] = useState('');
  const [created, setCreated] = useState<(WebhookRoute & { secret: string }) | null>(null);
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const validName = /^[a-z0-9][a-z0-9_-]*$/.test(slug);
  const destinations = [
    { id: 'log', name: t('settings.webhooks.nowhereLogOnly') },
    ...(targets.data?.targets ?? []).filter(
      (target) => target.id !== 'local' && !target.id.includes(':'),
    ),
  ];

  const create = useMutation({
    mutationFn: () =>
      createWebhook({
        name: slug,
        description: description.trim() || undefined,
        events: splitList(events),
        prompt: prompt.trim() || undefined,
        skills: splitList(skills),
        deliver,
        deliver_only: false,
        deliver_chat_id: deliver !== 'log' && chatId.trim() !== '' ? chatId.trim() : undefined,
      }),
    onSuccess: (result) => {
      setCreated(result);
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (error) => toastError(error),
  });

  if (created !== null) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={t('settings.webhooks.createdTitle', { name: created.name })}
      >
        <div className="space-y-4 text-[13px]">
          <p className="text-text-secondary">{t('settings.webhooks.createdGiveUrl')}</p>
          {(
            [
              [t('settings.webhooks.urlLabel'), created.url],
              [t('settings.webhooks.secretLabel'), created.secret],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <p className="mb-1 font-medium text-text-primary">{label}</p>
              <div className="flex items-center gap-2 rounded-xl bg-surface-input px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-text-secondary">
                  {value}
                </code>
                <button
                  type="button"
                  aria-label={t('settings.webhooks.copyAria', { what: label })}
                  onClick={() =>
                    copy(
                      value,
                      label,
                      t('settings.webhooks.copied'),
                      t('settings.webhooks.copyFailed'),
                    )
                  }
                  className="yu-btn yu-btn-ghost size-7 shrink-0 rounded-lg"
                >
                  <Copy className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-text-tertiary">{t('settings.webhooks.createdUrlHint')}</p>
          <button
            type="button"
            onClick={onClose}
            className="yu-btn yu-btn-primary h-9 rounded-xl px-4"
          >
            {t('common.close')}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('settings.webhooks.newTitle')}
      subtitle={t('settings.webhooks.newSubtitle')}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (validName) create.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-text-primary">
            {t('settings.webhooks.nameLabel')}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="github-push"
            className="yu-input h-10 w-full px-3 font-mono text-sm"
          />
          <span className="mt-1 block text-xs text-text-tertiary">
            {slug === ''
              ? t('settings.webhooks.slugHintEmpty')
              : validName
                ? t('settings.webhooks.slugHintValid', { slug })
                : t('settings.webhooks.slugHintInvalid')}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-text-primary">
            {t('settings.webhooks.descriptionLabel')}
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="yu-input h-10 w-full px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-text-primary">
            {t('settings.webhooks.promptLabel')}
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('settings.webhooks.promptPlaceholder')}
            className="yu-input min-h-28 w-full px-3 py-2 text-[13px]"
          />
          <span className="mt-1 block text-xs text-text-tertiary">
            {t('settings.webhooks.promptHint')}
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">
              {t('settings.webhooks.eventsLabel')}
            </span>
            <input
              value={events}
              onChange={(event) => setEvents(event.target.value)}
              placeholder="push, pull_request"
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">
              {t('settings.webhooks.skillsLabel')}
            </span>
            <input
              value={skills}
              onChange={(event) => setSkills(event.target.value)}
              placeholder="github"
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
          </label>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-text-primary">
            {t('settings.webhooks.sendAnswerTo')}
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label={t('settings.webhooks.deliveryAria')}
          >
            {destinations.map((target) => (
              <button
                key={target.id}
                type="button"
                role="radio"
                aria-checked={deliver === target.id}
                onClick={() => setDeliver(target.id)}
                className={['yu-chip', deliver === target.id ? 'yu-chip-accent' : ''].join(' ')}
              >
                {target.name}
              </button>
            ))}
          </div>
          {deliver !== 'log' ? (
            <input
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder={t('settings.webhooks.chatIdPlaceholder')}
              className="yu-input mt-2 h-10 w-full px-3 font-mono text-[13px]"
            />
          ) : null}
        </div>
        <button
          type="submit"
          disabled={!validName || create.isPending}
          className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
        >
          {create.isPending ? t('settings.webhooks.creating') : t('settings.webhooks.create')}
        </button>
      </form>
    </Sheet>
  );
}

/** Webhooks: inbound events that wake Hermes with a prompt. */
export function WebhooksPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: fetchWebhooks });
  const [creating, setCreating] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setWebhookEnabled(name, enabled),
    onMutate: async ({ name, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['webhooks'] });
      const previous = queryClient.getQueryData<WebhooksData>(['webhooks']);
      queryClient.setQueryData<WebhooksData>(['webhooks'], (current) =>
        current === undefined
          ? current
          : {
              ...current,
              subscriptions: current.subscriptions.map((hook: WebhookRoute) =>
                hook.name === name ? { ...hook, enabled } : hook,
              ),
            },
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(['webhooks'], context?.previous);
      toastError(error);
    },
    onSuccess: (_data, { name, enabled }) =>
      toast(
        t('settings.webhooks.toggled', {
          name,
          state: enabled ? t('settings.webhooks.enabledWord') : t('settings.webhooks.pausedWord'),
        }),
        'success',
      ),
  });

  const turnOn = useMutation({
    mutationFn: enableWebhooks,
    onSuccess: (result) => {
      toast(
        result.needs_restart === true
          ? t('settings.webhooks.onNeedsRestart')
          : t('settings.webhooks.onRestarted'),
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (error) => toastError(error),
  });
  const remove = async (name: string) => {
    const ok = await confirmDialog({
      title: t('settings.webhooks.deleteTitle', { name }),
      description: t('settings.webhooks.deleteDesc'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteWebhook(name);
      toast(t('settings.webhooks.deleted', { name }), 'success');
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <SettingsPage
      title={t('settings.webhooks.title')}
      description={t('settings.webhooks.description')}
      actions={
        hooks.data?.enabled ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="yu-btn yu-btn-tonal h-8 gap-1.5 rounded-lg px-3 text-xs"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('settings.webhooks.newButton')}
          </button>
        ) : undefined
      }
    >
      {hooks.isError ? (
        <ErrorNote message={hooks.error.message} onRetry={() => void hooks.refetch()} />
      ) : hooks.isPending ? (
        <SkeletonRows rows={3} />
      ) : !hooks.data.enabled ? (
        <Card className="flex flex-col items-center px-6 py-10 text-center">
          <Webhook className="mb-3 size-6 text-text-tertiary" aria-hidden />
          <p className="text-sm font-medium text-text-primary">{t('settings.webhooks.offTitle')}</p>
          <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
            {t('settings.webhooks.offDesc')}
          </p>
          <button
            type="button"
            disabled={turnOn.isPending}
            onClick={async () => {
              const ok = await confirmDialog({
                title: t('settings.webhooks.turnOnTitle'),
                description: t('settings.webhooks.turnOnDesc'),
                confirmLabel: t('settings.webhooks.turnOn'),
              });
              if (ok) turnOn.mutate();
            }}
            className="yu-btn yu-btn-primary mt-4 h-9 gap-1.5 px-4 text-[13px]"
          >
            <Power className="size-4" aria-hidden />
            {turnOn.isPending
              ? t('settings.webhooks.turningOn')
              : t('settings.webhooks.turnOnButton')}
          </button>
        </Card>
      ) : hooks.data.subscriptions.length === 0 ? (
        <EmptyNote icon={<Webhook className="size-6" />} title={t('settings.webhooks.noneTitle')}>
          {t('settings.webhooks.noneBody')}
        </EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {hooks.data.subscriptions.map((hook) => (
            <Card key={hook.name} className={['p-4', hook.enabled ? '' : 'opacity-70'].join(' ')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    {hook.name}
                    {hook.events.map((event) => (
                      <Badge key={event}>{event}</Badge>
                    ))}
                    {hook.deliver !== '' ? <Badge tone="agent">→ {hook.deliver}</Badge> : null}
                  </p>
                  {hook.description !== '' ? (
                    <p className="mt-1 text-[13px] text-text-secondary">{hook.description}</p>
                  ) : null}
                </div>
                <Switch
                  label={t('settings.webhooks.switchAria', { name: hook.name })}
                  checked={hook.enabled}
                  onChange={(next) => toggle.mutate({ name: hook.name, enabled: next })}
                />
                <Menu
                  label={t('settings.webhooks.actionsFor', { name: hook.name })}
                  trigger={<MoreHorizontal className="size-4" aria-hidden />}
                  items={[
                    {
                      label: t('common.delete'),
                      icon: <Trash2 />,
                      danger: true,
                      onSelect: () => void remove(hook.name),
                    },
                  ]}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-input px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
                  {hook.url}
                </code>
                <button
                  type="button"
                  aria-label={t('settings.webhooks.copyUrlAria', { name: hook.name })}
                  className="yu-btn yu-btn-ghost size-7 rounded-lg"
                  onClick={() =>
                    copy(
                      hook.url,
                      t('settings.webhooks.urlLabel'),
                      t('settings.webhooks.copied'),
                      t('settings.webhooks.copyFailed'),
                    )
                  }
                >
                  <Copy className="size-3.5" aria-hidden />
                </button>
              </div>
              {hook.prompt !== '' ? (
                <p className="mt-2.5 line-clamp-2 text-xs text-text-tertiary">
                  <span className="text-text-secondary">{t('settings.webhooks.promptPrefix')}</span>{' '}
                  {hook.prompt}
                </p>
              ) : null}
              {hook.created_at !== null ? (
                <p className="mt-1 font-mono text-[10.5px] text-text-tertiary">
                  {t('settings.webhooks.createdPrefix', { when: relativeTime(hook.created_at) })}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {creating ? <NewWebhookSheet onClose={() => setCreating(false)} /> : null}
    </SettingsPage>
  );
}
