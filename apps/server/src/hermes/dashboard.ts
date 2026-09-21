/**
 * Hermes dashboard API client.
 *
 * The dashboard server (~150 FastAPI routes) is the ONLY surface exposing
 * config writes, env/secrets, model setting, MCP/skills/messaging management
 * and ops (doctor/update). Yuri's architecture directive: the dashboard is an
 * internal admin backend only — the browser never talks to it; this client
 * does, over loopback, with the shared session token (systemd drop-in).
 *
 * Contracts verified against hermes_cli/web_routers/* at upstream 30de041b
 * and probed live; see docs/HERMES-CAPABILITY-MATRIX.md.
 */

import { HermesHttpError } from './client';

export interface DashboardClientOptions {
  baseUrl: string;
  sessionToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HermesDashboardClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly baseUrl: string,
    private readonly sessionToken?: string,
    options: Partial<Omit<DashboardClientOptions, 'baseUrl' | 'sessionToken'>> = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private authHeaders(base: Record<string, string> = {}): Record<string, string> {
    const headers = { ...base };
    if (this.sessionToken) {
      headers['x-hermes-session-token'] = this.sessionToken;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> } = { method: 'GET' },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...this.authHeaders(),
          ...init.headers,
        },
        body: init.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let detail: unknown = bodyText || undefined;
        try {
          detail = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
        } catch {
          // keep raw text
        }
        const message =
          typeof detail === 'object' && detail !== null && 'detail' in detail
            ? String((detail as { detail?: unknown }).detail ?? bodyText)
            : bodyText || `Dashboard returned ${response.status} for ${init.method} ${path}`;
        throw new HermesHttpError(response.status, `HERMES_DASHBOARD_${response.status}`, message, detail);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof HermesHttpError) {
        throw error;
      }
      throw new HermesHttpError(
        503,
        'HERMES_DASHBOARD_UNREACHABLE',
        `Could not reach the Hermes dashboard API at ${this.baseUrl}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // -- Config (PRD 31: raw config + schema-driven settings) -------------------

  getConfigRaw(): Promise<{ yaml: string; path: string }> {
    return this.request('/api/config/raw');
  }

  /** Full-document replacement; the dashboard validates YAML (400 on junk). */
  putConfigRaw(yamlText: string): Promise<{ ok: boolean }> {
    return this.request('/api/config/raw', {
      method: 'PUT',
      body: JSON.stringify({ yaml_text: yamlText }),
    });
  }

  getConfig(): Promise<unknown> {
    return this.request('/api/config');
  }

  getSchema(): Promise<{ fields: Record<string, unknown>; category_order: string[] }> {
    return this.request('/api/config/schema');
  }

  getDefaults(): Promise<unknown> {
    return this.request('/api/config/defaults');
  }

  /**
   * Deep-merge write (PRD 77): body {config} merges over disk config; the
   * caller re-reads to confirm. Mutating.
   */
  putConfig(config: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/config', { method: 'PUT', body: JSON.stringify({ config }) });
  }

  // -- Environment / secrets (PRD 32) -----------------------------------------

  listEnv(): Promise<Record<string, unknown>> {
    return this.request('/api/env');
  }

  putEnv(key: string, value: string): Promise<unknown> {
    return this.request('/api/env', { method: 'PUT', body: JSON.stringify({ key, value }) });
  }

  deleteEnv(key: string): Promise<unknown> {
    return this.request('/api/env', { method: 'DELETE', body: JSON.stringify({ key }) });
  }

  // -- Models -----------------------------------------------------------------

  modelInfo(): Promise<unknown> {
    return this.request('/api/model/info');
  }

  modelOptions(): Promise<unknown> {
    return this.request('/api/model/options');
  }

  // -- MCP / Skills / Messaging ------------------------------------------------

  listMcpServers(): Promise<{ servers: unknown[] }> {
    return this.request('/api/mcp/servers');
  }

  listSkills(): Promise<unknown[]> {
    return this.request('/api/skills');
  }

  messagingPlatforms(): Promise<unknown> {
    return this.request('/api/messaging/platforms');
  }

  // -- Ops --------------------------------------------------------------------

  doctor(): Promise<unknown> {
    return this.request('/api/ops/doctor', { method: 'POST' });
  }

  updateCheck(): Promise<unknown> {
    return this.request('/api/hermes/update/check');
  }

  /**
   * Mutating: applies the update (git installs only; the dashboard enforces
   * admission and restarts the gateway). Deny-by-default: custom-patched
   * installs MUST NOT auto-apply. Only reachable with
   * HERMES_WEBUI_ALLOW_UPDATE_APPLY=1 (operator opt-in).
   */
  updateApply(): Promise<unknown> {
    return this.request('/api/hermes/update', { method: 'POST' });
  }

  /** Log lines from ~/.hermes/logs (agent | gateway | errors). */
  logs(file: string, lines: number): Promise<{ file: string; lines: string[] }> {
    return this.request(`/api/logs?file=${encodeURIComponent(file)}&lines=${lines}`);
  }

  /**
   * Mutating: restarts the Hermes gateway (spawns `hermes gateway restart`
   * detached, systemd performs the supervisor handoff). Confirmed in the UI
   * before calling (PRD 29.2).
   */
  gatewayRestart(): Promise<unknown> {
    return this.request('/api/gateway/restart', { method: 'POST' });
  }
}
