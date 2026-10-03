import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Settings2, Wrench } from 'lucide-react';
import { fetchToolsets, toggleToolset, type ToolsetInfo } from '../../lib/hx';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, SkeletonRows, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';
import { ToolsetSheet } from './ToolsetSheet';

/** Tools: the toolsets Hermes can use, each with its tools and an on/off switch. */
export function ToolsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toolsets = useQuery({ queryKey: ['toolsets'], queryFn: fetchToolsets });
  const [setup, setSetup] = useState<ToolsetInfo | null>(null);

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      toggleToolset(name, enabled),
    onMutate: async ({ name, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['toolsets'] });
      const previous = queryClient.getQueryData<ToolsetInfo[]>(['toolsets']);
      queryClient.setQueryData<ToolsetInfo[]>(['toolsets'], (current) =>
        current?.map((toolset) => (toolset.name === name ? { ...toolset, enabled } : toolset)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(['toolsets'], context?.previous);
      toastError(error);
    },
    onSuccess: (_data, { name, enabled }) =>
      toast(
        enabled
          ? t('settings.tools.enabledToast', { name })
          : t('settings.tools.disabledToast', { name }),
        'success',
      ),
  });

  const list = [...(toolsets.data ?? [])].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label),
  );

  return (
    <SettingsPage title={t('settings.tools.title')} description={t('settings.tools.description')}>
      <p className="mb-5 rounded-2xl bg-chip px-4 py-3 text-[13px] leading-relaxed text-text-secondary">
        {t('settings.tools.noteStart')}
        <code className="font-mono text-xs">hermes tools</code>
        {t('settings.tools.noteMid')}
        <code className="font-mono text-xs">platform_toolsets</code>
        {t('settings.tools.noteEnd')}
      </p>
      {toolsets.isError ? (
        <ErrorNote message={toolsets.error.message} onRetry={() => void toolsets.refetch()} />
      ) : toolsets.isPending ? (
        <SkeletonRows rows={5} />
      ) : list.length === 0 ? (
        <EmptyNote icon={<Wrench className="size-6" />} title={t('settings.tools.noneReported')} />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {list.map((toolset) => (
            <Card
              key={toolset.name}
              className={['flex flex-col p-4', toolset.enabled ? '' : 'opacity-70'].join(' ')}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    {toolset.label}
                    {!toolset.configured ? (
                      <Badge tone="warning">{t('settings.tools.needsSetup')}</Badge>
                    ) : null}
                    {toolset.platform_label ? <Badge>{toolset.platform_label}</Badge> : null}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                    {toolset.description}
                  </p>
                </div>
                <Switch
                  label={t('settings.tools.switchAria', { label: toolset.label })}
                  checked={toolset.enabled}
                  onChange={(next) => toggle.mutate({ name: toolset.name, enabled: next })}
                />
              </div>
              <button
                type="button"
                onClick={() => setSetup(toolset)}
                className={[
                  'yu-btn mt-3 h-7 self-start rounded-lg px-2.5 text-xs',
                  toolset.configured ? 'yu-btn-ghost text-text-secondary' : 'yu-btn-tonal',
                ].join(' ')}
              >
                <Settings2 className="size-3.5" aria-hidden />
                {toolset.configured
                  ? t('settings.tools.providerAndKeys')
                  : t('settings.tools.setUp')}
              </button>
              {toolset.tools.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {toolset.tools.slice(0, 8).map((tool) => (
                    <span
                      key={tool}
                      className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-[10.5px] text-text-tertiary"
                    >
                      {tool}
                    </span>
                  ))}
                  {toolset.tools.length > 8 ? (
                    <span className="px-1 font-mono text-[10.5px] text-text-tertiary">
                      +{toolset.tools.length - 8}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {setup !== null ? <ToolsetSheet toolset={setup} onClose={() => setSetup(null)} /> : null}
    </SettingsPage>
  );
}
