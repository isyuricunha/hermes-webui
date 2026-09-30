import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Webhook } from 'lucide-react';
import { fetchWebhooks, setWebhookEnabled, type WebhookRoute } from '../../lib/hx';
import { copyText } from '../../lib/clipboard';
import { relativeTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, SkeletonRows, Switch } from '../../components/ui';
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

  return (
    <SettingsPage title="Webhooks" description="Events from other services that wake Hermes with a prompt.">
      {hooks.isError ? (
        <ErrorNote message={hooks.error.message} onRetry={() => void hooks.refetch()} />
      ) : hooks.isPending ? (
        <SkeletonRows rows={3} />
      ) : !hooks.data.enabled ? (
        <EmptyNote icon={<Webhook className="size-6" />} title="Webhooks are off">
          Turn the webhook platform on in the Hermes dashboard (Channels) to receive events.
        </EmptyNote>
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
