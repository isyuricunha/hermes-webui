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

/**
 * Bearer token source for a gated dashboard (auth mode "hermes"): the
 * dashboard session obtained when the user signed in with Hermes.
 */
export interface DashboardTokenSource {
  current(): string | null;
  /** Rotates the token; null when the session can no longer be renewed. */
  refresh(): Promise<string | null>;
}

export class HermesDashboardClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tokenSource?: DashboardTokenSource;

  constructor(
    readonly baseUrl: string,
    private readonly sessionToken?: string,
    options: Partial<Omit<DashboardClientOptions, 'baseUrl' | 'sessionToken'>> & {
      tokenSource?: DashboardTokenSource;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.tokenSource = options.tokenSource;
  }

  private authHeaders(base: Record<string, string> = {}): Record<string, string> {
    const headers = { ...base };
    const bearer = this.tokenSource?.current() ?? null;
    if (bearer !== null) {
      headers.authorization = `Bearer ${bearer}`;
    } else if (this.sessionToken) {
      headers['x-hermes-session-token'] = this.sessionToken;
    }
    return headers;
  }

  private async send(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
    signal: AbortSignal,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...this.authHeaders(),
        ...init.headers,
      },
      body: init.body,
      signal,
    });
  }

  /**
   * One authenticated exchange with the dashboard: bearer/session header,
   * a single refresh-and-retry on 401, and error mapping. Returns the raw
   * Response on success so callers can parse JSON or stream bytes.
   */
  private async exchange(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await this.send(path, init, controller.signal);
      if (response.status === 401 && this.tokenSource !== undefined) {
        // Access token lapsed: rotate once through the refresh token, retry once.
        const renewed = await this.tokenSource.refresh();
        if (renewed !== null) {
          response = await this.send(path, init, controller.signal);
        }
      }
      if (response.status === 401 && this.tokenSource !== undefined) {
        // 502, not 401: the WebUI session is fine; only the upstream one lapsed.
        throw new HermesHttpError(
          502,
          'HERMES_DASHBOARD_SESSION_EXPIRED',
          'The Hermes dashboard session expired. Sign out and sign in again to renew it.',
        );
      }
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
      // The timeout guards connect + headers; bodies are small JSON or a
      // stream the caller owns.
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof HermesHttpError) {
        throw error;
      }
      throw new HermesHttpError(
        503,
        'HERMES_DASHBOARD_UNREACHABLE',
        `Could not reach the Hermes dashboard API at ${this.baseUrl}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> } = { method: 'GET' },
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const response = await this.exchange(path, init, timeoutMs);
    if (response.status === 204) {
      return undefined as T;
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new HermesHttpError(
        502,
        'HERMES_DASHBOARD_BAD_RESPONSE',
        `The Hermes dashboard returned an unreadable response for ${init.method} ${path}: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  /** Allowlisted pass-through (routes/hermesProxy.ts): JSON in, JSON out. */
  call<T = unknown>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>(
      path,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      timeoutMs ?? this.timeoutMs,
    );
  }

  /** Allowlisted pass-through for downloads: the caller streams the body. */
  download(path: string, timeoutMs?: number): Promise<Response> {
    return this.exchange(path, { method: 'GET', headers: { accept: '*/*' } }, timeoutMs ?? this.timeoutMs * 4);
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

  setMcpServerEnabled(name: string, enabled: boolean): Promise<unknown> {
    return this.request(`/api/mcp/servers/${encodeURIComponent(name)}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  testMcpServer(name: string): Promise<unknown> {
    return this.request(`/api/mcp/servers/${encodeURIComponent(name)}/test`, { method: 'POST' });
  }

  /** PRD 22.2: assign the main/auxiliary model slot (mutating; dashboard validates). */
  setModelAssignment(assignment: {
    scope: 'main' | 'auxiliary';
    provider?: string;
    model: string;
    confirm_expensive_model?: boolean;
  }): Promise<unknown> {
    return this.request('/api/model/set', {
      method: 'POST',
      body: JSON.stringify(assignment),
    });
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
