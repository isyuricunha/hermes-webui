/**
 * Hermes API client (scaffold).
 *
 * PRD 6.5: API first, config second, CLI bridge last. This client is the
 * single place the backend talks to the Hermes gateway. The concrete routes
 * and payloads MUST come from docs/HERMES-CAPABILITY-MATRIX.md (spike
 * evidence), never guessed. Until the matrix lands, this client only probes
 * reachability.
 */

export interface HermesClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type HermesProbe = { reachable: true; probe: string } | { reachable: false; error: string };

/** Candidate health paths, confirmed/trimmed by the capability matrix. */
const PROBE_PATHS = ['/', '/health', '/healthz', '/docs', '/openapi.json'] as const;

export class HermesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    public readonly baseUrl: string,
    options: Partial<HermesClientOptions> = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  /**
   * Probe the gateway with cheap GETs until one answers. Returns the first
   * path that responded so later work can trust the same surface.
   */
  async checkReachable(): Promise<HermesProbe> {
    for (const path of PROBE_PATHS) {
      try {
        const response = await this.get(path);
        if (response.ok) {
          return { reachable: true, probe: path };
        }
      } catch {
        // try next path
      }
    }
    return { reachable: false, error: `no probe answered on ${this.baseUrl}` };
  }

  private async get(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
