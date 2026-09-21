import { useQuery } from '@tanstack/react-query';
import { fetchMcpServers } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** MCP servers (PRD 24): list with transport, enabled state and auth shape. */
export function McpPage() {
  const serversQuery = useQuery({ queryKey: ['mcp-servers'], queryFn: fetchMcpServers });

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
      {servers.length === 0 ? (
        <p className="text-sm text-text-secondary">No MCP servers configured.</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => (
            <li
              key={server.name}
              className="rounded-lg border border-border-subtle bg-surface-elevated p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{server.name}</p>
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    server.enabled ? 'bg-success/10 text-success' : 'bg-surface text-text-secondary',
                  ].join(' ')}
                >
                  {server.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-text-secondary">
                {server.transport}
                {server.url ? ` · ${server.url}` : ''}
                {server.auth ? ` · auth: ${server.auth}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-text-secondary">
        Add/remove/test arrives with the MCP detail editor; Raw Config edits
        mcp_servers directly meanwhile.
      </p>
    </SettingsPage>
  );
}
