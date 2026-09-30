/**
 * Hermes identity (auth mode "hermes"): the WebUI signs people in with the
 * same username/password the Hermes dashboard uses, so there is a single
 * credential for the whole Hermes install.
 *
 * Verification goes through the dashboard's own password provider
 * (`POST /auth/password-login`), which is the dashboard's machine-usable
 * sign-in path. A successful login also yields the dashboard's session
 * tokens; the WebUI keeps them server-side and uses the access token as a
 * bearer for its dashboard API calls (config, env, models, MCP, ops),
 * rotating it through `POST /auth/native/refresh` when it lapses. The
 * browser never sees either token and the password is never stored.
 */

import type { AuthStore, HermesTokens } from '../auth/store';

export type HermesIdentityErrorKind = 'invalid_credentials' | 'rate_limited' | 'unavailable';

export class HermesIdentityError extends Error {
  constructor(
    readonly kind: HermesIdentityErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const ACCESS_COOKIE = 'hermes_session_at';
const REFRESH_COOKIE = 'hermes_session_rt';

interface ParsedCookie {
  name: string;
  value: string;
  maxAgeSeconds: number | null;
}

export function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(';');
  if (pair === undefined) {
    return null;
  }
  const eq = pair.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  let maxAgeSeconds: number | null = null;
  for (const attribute of attributes) {
    const [key, raw] = attribute.trim().split('=');
    if (key?.toLowerCase() === 'max-age' && raw !== undefined) {
      const parsed = Number.parseInt(raw, 10);
      maxAgeSeconds = Number.isFinite(parsed) ? parsed : null;
    }
  }
  return {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim().replace(/^"|"$/g, ''),
    maxAgeSeconds,
  };
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
}

export class HermesIdentity {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly dashboardUrl: string,
    readonly provider: string,
    options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.dashboardUrl}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      throw new HermesIdentityError(
        'unavailable',
        `Hermes dashboard unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Verifies the credentials with Hermes; returns the dashboard session tokens. */
  async passwordLogin(username: string, password: string): Promise<HermesTokens> {
    const response = await this.post('/auth/password-login', {
      provider: this.provider,
      username,
      password,
    });
    if (response.status === 401) {
      throw new HermesIdentityError('invalid_credentials', 'Invalid username or password.');
    }
    if (response.status === 429) {
      throw new HermesIdentityError('rate_limited', 'Too many attempts. Try again shortly.');
    }
    if (!response.ok) {
      throw new HermesIdentityError(
        'unavailable',
        response.status === 404
          ? `Hermes has no "${this.provider}" password provider enabled.`
          : `Hermes sign-in failed with status ${response.status}.`,
      );
    }
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let accessExpiresAt: number | null = null;
    for (const header of setCookieHeaders(response)) {
      const cookie = parseSetCookie(header);
      if (cookie === null || cookie.value === '') {
        continue;
      }
      if (cookie.name === ACCESS_COOKIE) {
        accessToken = cookie.value;
        accessExpiresAt =
          cookie.maxAgeSeconds === null ? null : Date.now() + cookie.maxAgeSeconds * 1000;
      } else if (cookie.name === REFRESH_COOKIE) {
        refreshToken = cookie.value;
      }
    }
    if (accessToken === null) {
      throw new HermesIdentityError('unavailable', 'Hermes accepted the sign-in but issued no session.');
    }
    return { accessToken, refreshToken, accessExpiresAt };
  }

  /** Rotates the dashboard tokens. Returns null when the refresh token is no longer valid. */
  async refresh(refreshToken: string): Promise<HermesTokens | null> {
    const response = await this.post('/auth/native/refresh', {
      refresh_token: refreshToken,
      provider: this.provider,
    });
    if (response.status === 401 || response.status === 400) {
      return null;
    }
    if (!response.ok) {
      throw new HermesIdentityError('unavailable', `Hermes token refresh failed with status ${response.status}.`);
    }
    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      return null;
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
      accessExpiresAt: typeof body.expires_at === 'number' ? body.expires_at * 1000 : null,
    };
  }
}

/**
 * Supplies the dashboard bearer token to HermesDashboardClient and rotates it
 * on demand. Concurrent 401s share one refresh (single flight).
 */
export class HermesDashboardSession {
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly identity: HermesIdentity,
    private readonly store: AuthStore,
  ) {}

  current(): string | null {
    return this.store.getHermesTokens()?.accessToken ?? null;
  }

  refresh(): Promise<string | null> {
    if (this.inflight === null) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<string | null> {
    const tokens = this.store.getHermesTokens();
    if (tokens?.refreshToken == null) {
      return null;
    }
    const next = await this.identity.refresh(tokens.refreshToken);
    if (next === null) {
      this.store.clearHermesTokens();
      return null;
    }
    this.store.saveHermesTokens(next);
    return next.accessToken;
  }
}
