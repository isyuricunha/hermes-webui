import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FlaskConical, Globe, MoreHorizontal, Plug, Plus, SquareTerminal, Trash2 } from 'lucide-react';
import { fetchMcpServers, setMcpServerEnabled, testMcpServer, type McpServer } from '../../lib/api';
import { addMcpServer, removeMcpServer, type McpServerInput } from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, EmptyNote, ErrorNote, Menu, Segmented, Sheet, SkeletonRows, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const APPLY_NOTE = 'Hermes connects MCP servers when a conversation starts: new chats see the change, a running one after /new or /reset.';

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function AddServerSheet({ onClose }: { onClose: () => void }) {
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
          ? { name: name.trim(), url: url.trim(), auth: token.trim() !== '' ? 'header' : 'none', ...(token.trim() !== '' ? { bearer_token: token.trim() } : {}) }
          : { name: name.trim(), command: command.trim(), args: args.split('\n').map((a) => a.trim()).filter((a) => a !== ''), env: parseEnv(envText) };
      return addMcpServer(input);
    },
    onSuccess: () => {
      toast(`${name.trim()} added. ${APPLY_NOTE}`, 'success', { durationMs: 7000 });
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      onClose();
    },
    onError: (error) => toastError(error),
  });
  const valid = /^[A-Za-z0-9._-]+$/.test(name.trim()) && (kind === 'http' ? /^https?:\/\//.test(url.trim()) : command.trim() !== '');

  return (
    <Sheet open onClose={onClose} title="Add MCP server" subtitle="Saved to config.yaml (mcp_servers)">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) add.mutate();
        }}
      >
        <Segmented
          label="Server type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'http', label: 'Remote (URL)' },
            { value: 'stdio', label: 'Local command' },
          ]}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs text-text-secondary">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="yu-input h-10 w-full px-3 font-mono text-sm" placeholder="github" />
        </label>
        {kind === 'http' ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">Server URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="yu-input h-10 w-full px-3 font-mono text-sm" placeholder="https://mcp.example.com/mcp" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">Bearer token (optional)</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" className="yu-input h-10 w-full px-3 font-mono text-sm" />
              <span className="mt-1 block text-[11px] text-text-tertiary">Stored in the profile .env, never in config.yaml.</span>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">Command</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} className="yu-input h-10 w-full px-3 font-mono text-sm" placeholder="npx" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">Arguments (one per line)</span>
              <textarea value={args} onChange={(e) => setArgs(e.target.value)} className="yu-input min-h-20 w-full px-3 py-2 font-mono text-[13px]" placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/home/me/docs'} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-text-secondary">Environment (KEY=value per line, optional)</span>
              <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} className="yu-input min-h-16 w-full px-3 py-2 font-mono text-[13px]" />
            </label>
          </>
        )}
        <p className="text-[11px] text-text-tertiary">{APPLY_NOTE}</p>
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
          <button type="button" onClick={onClose} className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]">
            Cancel
          </button>
          <button type="submit" disabled={!valid || add.isPending} className="yu-btn yu-btn-primary h-9 px-4 text-[13px]">
            {add.isPending ? 'Adding…' : 'Add server'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** MCP servers: on/off, connection test, add and remove. */
export function McpPage() {
  const queryClient = useQueryClient();
  const serversQuery = useQuery({ queryKey: ['mcp-servers'], queryFn: fetchMcpServers });
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => setMcpServerEnabled(name, enabled),
    onSuccess: (_data, { name, enabled }) => {
      toast(`${name} ${enabled ? 'enabled' : 'disabled'}. ${APPLY_NOTE}`, 'success', { durationMs: 7000 });
      invalidate();
    },
    onError: (error) => toastError(error),
  });
  const test = useMutation({
    mutationFn: (name: string) => testMcpServer(name),
    onSuccess: (data, name) => {
      const result = data as { ok?: boolean; error?: string; tools?: unknown[]; tool_count?: number };
      const count = result.tool_count ?? (Array.isArray(result.tools) ? result.tools.length : undefined);
      setTests((current) => ({
        ...current,
        [name]: { ok: result.ok === true, detail: result.ok === true ? `Connected${count !== undefined ? `, ${count} tools` : ''}` : (result.error ?? 'Failed') },
      }));
    },
    onError: (error, name) => setTests((current) => ({ ...current, [name]: { ok: false, detail: error.message } })),
  });
  const remove = async (server: McpServer) => {
    const ok = await confirmDialog({
      title: `Remove ${server.name}?`,
      description: `Deletes it from mcp_servers in config.yaml. ${APPLY_NOTE}`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeMcpServer(server.name);
      toast(`${server.name} removed.`, 'success');
      invalidate();
    } catch (error) {
      toastError(error);
    }
  };

  const servers = serversQuery.data?.servers ?? [];
  return (
    <SettingsPage
      title="MCP"
      description="Model Context Protocol servers give Hermes extra tools (GitHub, files, databases…)."
      actions={
        <button type="button" onClick={() => setAdding(true)} className="yu-btn yu-btn-tonal h-9 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" aria-hidden /> Add server
        </button>
      }
    >
      {serversQuery.isError ? (
        <ErrorNote message={serversQuery.error.message} onRetry={() => void serversQuery.refetch()} />
      ) : serversQuery.isPending ? (
        <SkeletonRows rows={3} />
      ) : servers.length === 0 ? (
        <EmptyNote icon={<Plug className="size-6" />} title="No MCP servers">
          Add one to give Hermes new tools.
        </EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {servers.map((server) => {
            const remote = server.transport !== 'stdio' && (server.url ?? '') !== '';
            const result = tests[server.name];
            return (
              <Card key={server.name} className={['p-4', server.enabled ? '' : 'opacity-75'].join(' ')}>
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary">
                    {remote ? <Globe className="size-4" aria-hidden /> : <SquareTerminal className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                      {server.name}
                      <Badge>{server.transport}</Badge>
                      {server.auth !== undefined && server.auth !== null && server.auth !== 'none' ? <Badge tone="agent">auth: {server.auth}</Badge> : null}
                      {!server.enabled ? <Badge>Off</Badge> : null}
                    </p>
                    {server.url ? <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-tertiary">{server.url}</p> : null}
                    {result !== undefined ? (
                      <p className={['mt-1.5 text-xs', result.ok ? 'text-success' : 'text-danger'].join(' ')}>{result.detail}</p>
                    ) : null}
                  </div>
                  <Switch
                    label={`${server.name} enabled`}
                    checked={server.enabled}
                    disabled={toggle.isPending && toggle.variables?.name === server.name}
                    onChange={(next) => toggle.mutate({ name: server.name, enabled: next })}
                  />
                  <Menu
                    label={`Actions for ${server.name}`}
                    trigger={<MoreHorizontal className="size-4" aria-hidden />}
                    items={[
                      { label: 'Test connection', icon: <FlaskConical />, onSelect: () => test.mutate(server.name) },
                      { label: 'Remove', icon: <Trash2 />, danger: true, onSelect: () => void remove(server) },
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
                    {test.isPending && test.variables === server.name ? 'Testing…' : 'Test'}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-text-tertiary">{APPLY_NOTE}</p>
      {adding ? <AddServerSheet onClose={() => setAdding(false)} /> : null}
    </SettingsPage>
  );
}
