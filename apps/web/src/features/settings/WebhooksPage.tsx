import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, Power, Trash2, Webhook } from 'lucide-react';
import { deleteWebhook, enableWebhooks, fetchWebhooks, setWebhookEnabled, type WebhookRoute } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { copyText } from '../../lib/clipboard';
import { relativeTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Menu, SkeletonRows, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

type WebhooksData = Awaited<ReturnType<typeof fetchWebhooks>>;

/** Webhooks: inbound events that wake Hermes with a prompt. */
export function WebhooksPage() {
  const queryClient = useQueryClient();
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: fetchWebhooks });
  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => setWebhookEnabled(name, enabled),
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
    onSuccess: (_data, { name, enabled }) => toast(`${name} ${enabled ? 'enabled' : 'paused'}.`, 'success'),
  });

  const turnOn = useMutation({
    mutationFn: enableWebhooks,
    onSuccess: (result) => {
      toast(result.needs_restart === true ? 'Webhooks on. Restart the gateway (Settings > System) to start listening.' : 'Webhooks on. The gateway restarted to listen for them.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (error) => toastError(error),
  });
  const remove = async (name: string) => {
    const ok = await confirmDialog({
      title: `Delete webhook ${name}?`,
      description: 'Its URL stops working immediately. Services still calling it get an error.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteWebhook(name);
      toast(`${name} deleted.`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <SettingsPage title="Webhooks" description="Events from other services that wake Hermes with a prompt.">
      {hooks.isError ? (
        <ErrorNote message={hooks.error.message} onRetry={() => void hooks.refetch()} />
      ) : hooks.isPending ? (
        <SkeletonRows rows={3} />
      ) : !hooks.data.enabled ? (
        <Card className="flex flex-col items-center px-6 py-10 text-center">
          <Webhook className="mb-3 size-6 text-text-tertiary" aria-hidden />
          <p className="text-sm font-medium text-text-primary">Webhooks are off</p>
          <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
            The webhook platform is disabled in Hermes, so no URL is listening. Turning it on writes the setting and restarts the gateway (a few seconds offline).
          </p>
          <button
            type="button"
            disabled={turnOn.isPending}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Turn webhooks on?',
                description: 'Hermes enables the webhook platform and restarts the gateway. Running replies are interrupted.',
                confirmLabel: 'Turn on',
              });
              if (ok) turnOn.mutate();
            }}
            className="yu-btn yu-btn-primary mt-4 h-9 gap-1.5 px-4 text-[13px]"
          >
            <Power className="size-4" aria-hidden />
            {turnOn.isPending ? 'Turning on…' : 'Turn on webhooks'}
          </button>
        </Card>
      ) : hooks.data.subscriptions.length === 0 ? (
        <EmptyNote icon={<Webhook className="size-6" />} title="No webhooks yet">
          Create one with <code className="font-mono text-xs">hermes webhooks add</code> or in the dashboard.
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
                  {hook.description !== '' ? <p className="mt-1 text-[13px] text-text-secondary">{hook.description}</p> : null}
                </div>
                <Switch
                  label={`${hook.name} enabled`}
                  checked={hook.enabled}
                  onChange={(next) => toggle.mutate({ name: hook.name, enabled: next })}
                />
                <Menu
                  label={`Actions for ${hook.name}`}
                  trigger={<MoreHorizontal className="size-4" aria-hidden />}
                  items={[{ label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void remove(hook.name) }]}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-input px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">{hook.url}</code>
                <button
                  type="button"
                  aria-label={`Copy ${hook.name} URL`}
                  className="yu-btn yu-btn-ghost size-7 rounded-lg"
                  onClick={() =>
                    void copyText(hook.url).then(
                      () => toast('Webhook URL copied.', 'success'),
                      () => toast('Copy failed.', 'error'),
                    )
                  }
                >
                  <Copy className="size-3.5" aria-hidden />
                </button>
              </div>
              {hook.prompt !== '' ? (
                <p className="mt-2.5 line-clamp-2 text-xs text-text-tertiary">
                  <span className="text-text-secondary">Prompt:</span> {hook.prompt}
                </p>
              ) : null}
              {hook.created_at !== null ? (
                <p className="mt-1 font-mono text-[10.5px] text-text-tertiary">created {relativeTime(hook.created_at)}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </SettingsPage>
  );
}
