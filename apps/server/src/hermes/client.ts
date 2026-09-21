/**
 * Hermes gateway API client (v2).
 *
 * Routes and contracts come from docs/HERMES-CAPABILITY-MATRIX.md (evidence:
 * gateway/platforms/api_server.py route table at upstream 30de041b plus
 * live probes). No invented endpoints: every method here maps to a route in
 * that table.
 *
 * Auth: Bearer API_SERVER_KEY for everything except /health. The key stays
 * server-side (apps/server/.env or service env) and is never sent to the
 * browser.
 */

export interface HermesClientOptions {
  gatewayUrl: string;
  /** API_SERVER_KEY of the gateway. Without it only /health is usable. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GatewayHealth {
  status: string;
  platform: string;
  version: string;
}

export class HermesHttpError extends Error {
  constructor(
    /** HTTP status we will surface (may be remapped for gateway auth issues). */
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HermesHttpError';
  }
}

export class HermesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly gatewayUrl: string,
    private readonly apiKey?: string,
    options: Partial<Omit<HermesClientOptions, 'gatewayUrl' | 'apiKey'>> = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Public, unauthenticated. Returns version on success. */
  async health(): Promise<GatewayHealth> {
    return this.request<GatewayHealth>('/health', { method: 'GET' }, { auth: false });
  }

  /** Authed capability flags (machine-readable feature detection). */
  async capabilities(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/v1/capabilities', { method: 'GET' });
  }

  listSessions(query: { limit?: number; offset?: number } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return this.request(`/api/sessions${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  createSession(body: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
  }

  getSession(sessionId: string): Promise<unknown> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  }

  patchSession(sessionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  deleteSession(sessionId: string): Promise<unknown> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  getSessionMessages(sessionId: string): Promise<unknown> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'GET',
    });
  }

  /**
   * Durable run submission (PRD run lifecycle). The WebUI generates the
   * Idempotency-Key so client retries never double-submit.
   */
  createRun(
    body: { input: string; session_id?: string; model?: string },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request(
      '/v1/runs',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'idempotency-key': idempotencyKey },
      },
    );
  }

  getRun(runId: string): Promise<unknown> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}`, { method: 'GET' });
  }

  stopRun(runId: string): Promise<unknown> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
  }

  steerRun(runId: string, input: string): Promise<unknown> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
  }

  resolveApproval(
    runId: string,
    body: { choice: 'once' | 'session' | 'always' | 'deny'; request_id?: string; all?: boolean },
  ): Promise<unknown> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Opens the run event stream (SSE). Returns the raw Response; the caller
   * owns piping and abort. The gateway does not replay events on late
   * subscribe (matrix section 8): reconnect = poll status + resubscribe.
   */
  async openRunEvents(runId: string, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 60);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      controller.abort();
    });
    try {
      return await this.fetchImpl(`${this.gatewayUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        method: 'GET',
        headers: this.authHeaders({ accept: 'text/event-stream' }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new HermesHttpError(
        503,
        'HERMES_UNREACHABLE',
        `Could not reach Hermes gateway at ${this.gatewayUrl}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private authHeaders(base: Record<string, string> = {}): Record<string, string> {
    const headers = { ...base };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
    options: { auth?: boolean } = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.gatewayUrl}${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(auth ? this.authHeaders() : {}),
          ...init.headers,
        },
        body: init.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let gatewayBody: unknown = bodyText || undefined;
        try {
          gatewayBody = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
        } catch {
          // keep raw text
        }
        const gatewayMessage =
          typeof gatewayBody === 'object' && gatewayBody !== null && 'error' in gatewayBody
            ? String((gatewayBody as { error: { message?: unknown } }).error?.message ?? bodyText)
            : bodyText;
        throw new HermesHttpError(
          response.status,
          `HERMES_${response.status}`,
          gatewayMessage || `Hermes gateway returned ${response.status} for ${init.method} ${path}`,
          gatewayBody,
        );
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
        'HERMES_UNREACHABLE',
        `Could not reach Hermes gateway at ${this.gatewayUrl}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
