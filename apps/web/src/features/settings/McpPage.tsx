import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  fetchMcpServers,
  setMcpServerEnabled,
  testMcpServer,
} from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** MCP servers (PRD 24): list + enable/disable + test. Add/remove via Raw Config. */
export function McpPage() {
  const queryClient = useQueryClient();
  const serversQuery = useQuery({ queryKey: ['mcp-servers'], queryFn: fetchMcpServers });
  const [message, setMessage] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setMcpServerEnabled(name, enabled),
    onSuccess: (_data, variables) => {
      setMessage(`${variables.name}: ${variables.enabled ? 'enabled' : 'disabled'}.`);
      // MCP server config lives in config.yaml; flag the restart notice.
      window.dispatchEvent(new CustomEvent('hermes-webui:restart-required'));
      invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const test = useMutation({
    mutationFn: (name: string) => testMcpServer(name),
    onSuccess: (data, name) => {
      const result = data as { ok?: boolean; error?: string };
      setMessage(
        `${name}: ${result.ok ? 'test ok' : `test failed${result.error ? ` (${result.error})` : ''}`}`,
      );
      invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  if (serversQuery.isPending) {
    return (
      <SettingsPage title="MCP">
        <p className="text-sm text-text-secondary">Loading MCP servers…</p>
      </SettingsPage>
    );
  }
  if (serversQuery.isError) {
    return (
      <SettingsPage title="MCP">
        <SettingsError message={serversQuery.error.message} />
      </SettingsPage>
    );
  }

  const servers = serversQuery.data.servers ?? [];
  return (
    <SettingsPage title="MCP">
      {message ? <p className="mb-3 text-xs text-text-secondary">{message}</p> : null}
      {servers.length === 0 ? (
        <p className="text-sm text-text-secondary">No MCP servers configured.</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => (
            <li
              key={server.name}
              className="w-full yu-card rounded-2xl p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-words text-sm font-medium">{server.name}</p>
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    server.enabled ? 'bg-success/10 text-success' : 'bg-surface text-text-secondary',
                  ].join(' ')}
                >
                  {server.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="mt-1 break-all text-xs text-text-secondary">
                {server.transport}
                {server.url ? ` · ${server.url}` : ''}
                {server.auth ? ` · auth: ${server.auth}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => toggle.mutate({ name: server.name, enabled: !server.enabled })}
                  className="yu-btn yu-btn-secondary h-8 rounded-lg px-2.5 text-xs"
                >
                  {server.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => test.mutate(server.name)}
                  disabled={test.isPending}
                  className="yu-btn yu-btn-secondary h-8 rounded-lg px-2.5 text-xs"
                >
                  Test
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-text-secondary">
        Add/remove and per-tool selection: edit mcp_servers in Raw Config (applies on next agent
        build).
      </p>
    </SettingsPage>
  );
}
