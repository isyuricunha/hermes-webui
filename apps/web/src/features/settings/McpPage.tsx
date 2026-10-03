import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical,
  Globe,
  MoreHorizontal,
  Plug,
  Plus,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { fetchMcpServers, setMcpServerEnabled, testMcpServer, type McpServer } from '../../lib/api';
import { addMcpServer, removeMcpServer, type McpServerInput } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import {
  Badge,
  Card,
  EmptyNote,
  ErrorNote,
  Menu,
  Segmented,
  Sheet,
  SkeletonRows,
  Switch,
} from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const APPLY_NOTE = 'settings.mcp.applyNote';

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function AddServerSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'http' | 'stdio'>('http');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envText, setEnvText] = useState('');
  const [token, setToken] = useState('');
  const add = useMutation({
    mutationFn: () => {
      const input: McpServerInput =
        kind === 'http'
          ? {
              name: name.trim(),
              url: url.trim(),
              auth: token.trim() !== '' ? 'header' : 'none',
              ...(token.trim() !== '' ? { bearer_token: token.trim() } : {}),
            }
          : {
              name: name.trim(),
              command: command.trim(),
              args: args
                .split('\n')
                .map((a) => a.trim())
                .filter((a) => a !== ''),
              env: parseEnv(envText),
            };
      return addMcpServer(input);
    },
    onSuccess: () => {
      toast(t('settings.mcp.added', { name: name.trim(), applyNote: t(APPLY_NOTE) }), 'success', {
        durationMs: 7000,
      });
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      onClose();
    },
    onError: (error) => toastError(error),
  });
  const valid =
    /^[A-Za-z0-9._-]+$/.test(name.trim()) &&
    (kind === 'http' ? /^https?:\/\//.test(url.trim()) : command.trim() !== '');

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('settings.mcp.addTitle')}
      subtitle={t('settings.mcp.addSubtitle')}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) add.mutate();
        }}
      >
        <Segmented
          label={t('settings.mcp.serverType')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'http', label: t('settings.mcp.remoteUrl') },
            { value: 'stdio', label: t('settings.mcp.localCommand') },
          ]}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-secondary">{t('settings.mcp.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="yu-input h-10 w-full px-3 font-mono text-sm"
            placeholder={t('settings.mcp.namePlaceholder')}
          />
        </label>
        {kind === 'http' ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">
                {t('settings.mcp.serverUrl')}
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="yu-input h-10 w-full px-3 font-mono text-sm"
                placeholder={t('settings.mcp.urlPlaceholder')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">
                {t('settings.mcp.bearerToken')}
              </span>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                autoComplete="off"
                className="yu-input h-10 w-full px-3 font-mono text-sm"
              />
              <span className="mt-1 block text-[11px] text-text-tertiary">
                {t('settings.mcp.tokenHint')}
              </span>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">
                {t('settings.mcp.command')}
              </span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="yu-input h-10 w-full px-3 font-mono text-sm"
                placeholder={t('settings.mcp.commandPlaceholder')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">
                {t('settings.mcp.args')}
              </span>
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                className="yu-input min-h-20 w-full px-3 py-2 font-mono text-[13px]"
                placeholder={t('settings.mcp.argsPlaceholder')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">
                {t('settings.mcp.envLabel')}
              </span>
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                className="yu-input min-h-16 w-full px-3 py-2 font-mono text-[13px]"
              />
            </label>
          </>
        )}
        <p className="text-[11px] text-text-tertiary">{t(APPLY_NOTE)}</p>
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onClose}
            className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]"
          >
            {t('settings.mcp.cancel')}
          </button>
          <button
            type="submit"
            disabled={!valid || add.isPending}
            className="yu-btn yu-btn-primary h-9 px-4 text-[13px]"
          >
            {add.isPending ? t('settings.mcp.adding') : t('settings.mcp.addServer')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** MCP servers: on/off, connection test, add and remove. */
export function McpPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const serversQuery = useQuery({ queryKey: ['mcp-servers'], queryFn: fetchMcpServers });
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setMcpServerEnabled(name, enabled),
    onSuccess: (_data, { name, enabled }) => {
      toast(
        t('settings.mcp.toggled', {
          name,
          state: enabled ? t('settings.mcp.enabledWord') : t('settings.mcp.disabledWord'),
          applyNote: t(APPLY_NOTE),
        }),
        'success',
        { durationMs: 7000 },
      );
      invalidate();
    },
    onError: (error) => toastError(error),
  });
  const test = useMutation({
    mutationFn: (name: string) => testMcpServer(name),
    onSuccess: (data, name) => {
      const result = data as {
        ok?: boolean;
        error?: string;
        tools?: unknown[];
        tool_count?: number;
      };
      const count =
        result.tool_count ?? (Array.isArray(result.tools) ? result.tools.length : undefined);
      setTests((current) => ({
        ...current,
        [name]: {
          ok: result.ok === true,
          detail:
            result.ok === true
              ? count !== undefined
                ? t('settings.mcp.connectedTools', { count })
                : t('settings.mcp.connected')
              : (result.error ?? t('settings.mcp.failed')),
        },
      }));
    },
    onError: (error, name) =>
      setTests((current) => ({ ...current, [name]: { ok: false, detail: error.message } })),
  });
  const remove = async (server: McpServer) => {
    const ok = await confirmDialog({
      title: t('settings.mcp.removeTitle', { name: server.name }),
      description: t('settings.mcp.removeDesc', { applyNote: t(APPLY_NOTE) }),
      confirmLabel: t('settings.mcp.remove'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeMcpServer(server.name);
      toast(t('settings.mcp.removed', { name: server.name }), 'success');
      invalidate();
    } catch (error) {
      toastError(error);
    }
  };

  const servers = serversQuery.data?.servers ?? [];
  return (
    <SettingsPage
      title={t('settings.mcp.title')}
      description={t('settings.mcp.description')}
      actions={
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="yu-btn yu-btn-tonal h-9 gap-1.5 px-3.5 text-[13px]"
        >
          <Plus className="size-4" aria-hidden /> {t('settings.mcp.addServer')}
        </button>
      }
    >
      {serversQuery.isError ? (
        <ErrorNote
          message={serversQuery.error.message}
          onRetry={() => void serversQuery.refetch()}
        />
      ) : serversQuery.isPending ? (
        <SkeletonRows rows={3} />
      ) : servers.length === 0 ? (
        <EmptyNote icon={<Plug className="size-6" />} title={t('settings.mcp.noServersTitle')}>
          {t('settings.mcp.noServersBody')}
        </EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {servers.map((server) => {
            const remote = server.transport !== 'stdio' && (server.url ?? '') !== '';
            const result = tests[server.name];
            return (
              <Card
                key={server.name}
                className={['p-4', server.enabled ? '' : 'opacity-75'].join(' ')}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary">
                    {remote ? (
                      <Globe className="size-4" aria-hidden />
                    ) : (
                      <SquareTerminal className="size-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                      {server.name}
                      <Badge>{server.transport}</Badge>
                      {server.auth !== undefined &&
                      server.auth !== null &&
                      server.auth !== 'none' ? (
                        <Badge tone="agent">
                          {t('settings.mcp.authBadge', { auth: server.auth })}
                        </Badge>
                      ) : null}
                      {!server.enabled ? <Badge>{t('settings.mcp.offBadge')}</Badge> : null}
                    </p>
                    {server.url ? (
                      <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-tertiary">
                        {server.url}
                      </p>
                    ) : null}
                    {result !== undefined ? (
                      <p
                        className={[
                          'mt-1.5 text-xs',
                          result.ok ? 'text-success' : 'text-danger',
                        ].join(' ')}
                      >
                        {result.detail}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    label={t('settings.mcp.switchLabel', { name: server.name })}
                    checked={server.enabled}
                    disabled={toggle.isPending && toggle.variables?.name === server.name}
                    onChange={(next) => toggle.mutate({ name: server.name, enabled: next })}
                  />
                  <Menu
                    label={t('settings.mcp.actionsLabel', { name: server.name })}
                    trigger={<MoreHorizontal className="size-4" aria-hidden />}
                    items={[
                      {
                        label: t('settings.mcp.testConnection'),
                        icon: <FlaskConical />,
                        onSelect: () => test.mutate(server.name),
                      },
                      {
                        label: t('settings.mcp.remove'),
                        icon: <Trash2 />,
                        danger: true,
                        onSelect: () => void remove(server),
                      },
                    ]}
                  />
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => test.mutate(server.name)}
                    disabled={test.isPending && test.variables === server.name}
                    className="yu-btn yu-btn-tonal h-8 gap-1.5 px-3 text-xs"
                  >
                    <FlaskConical className="size-3.5" aria-hidden />
                    {test.isPending && test.variables === server.name
                      ? t('settings.mcp.testing')
                      : t('settings.mcp.test')}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-text-tertiary">{t(APPLY_NOTE)}</p>
      {adding ? <AddServerSheet onClose={() => setAdding(false)} /> : null}
    </SettingsPage>
  );
}
