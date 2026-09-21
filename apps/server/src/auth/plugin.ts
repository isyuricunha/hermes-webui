import { createHash, randomBytes } from 'node:crypto';
import fp from 'fastify-plugin';
import cookiePlugin from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { constantTimeEqual } from './tokens';
import type { AuthStore, SessionLifetimes, SessionRow, UserRow } from './store';
import type { AuthService } from './service';

/**
 * Central auth policy (Phase 1, spec 2.9): every /api/* route is
 * "required" unless it explicitly declares itself public. Forgetting to
 * declare a policy can never make a route public.
 */

export const SESSION_COOKIE = 'hermes_webui_session';
export const CSRF_HEADER = 'x-csrf-token';

export type RouteAuthPolicy = 'public' | 'required' | 'recent';

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      session: SessionRow | null;
      user: UserRow | null;
      recent: boolean;
    };
    /** Internal storage backing the `auth` getter/setter. */
    requestAuthState: {
      session: SessionRow | null;
      user: UserRow | null;
      recent: boolean;
    } | null;
  }
  interface FastifyContextConfig {
    auth?: RouteAuthPolicy;
  }
  interface FastifyInstance {
    invalidateSessionStreams: (sessionId: string) => void;
    /** Registers a stream for a session; returns its unregister function. */
    registerSessionStream: (sessionId: string, abort: () => void) => () => void;
  }
}

export interface AuthPluginOptions {
  store: AuthStore;
  service: AuthService;
  lifetimes: SessionLifetimes;
  secureCookie: boolean;
  ipHashSalt: string;
  /** Called when a session is revoked/expired so bound streams can be aborted. */
  onSessionInvalidated?: (sessionId: string) => void;
}

const RATE_WINDOW_MS = 10 * 60 * 1000;

/** In-memory failure buckets (spec 2.15): per-bucket window and limit. */
export class LoginRateLimiter {
  private buckets = new Map<string, { stamps: number[]; windowMs: number }>();

  attempt(key: string, limit: number): boolean {
    this.sweep();
    const entry = this.buckets.get(key);
    return (entry?.stamps.length ?? 0) < limit;
  }

  failure(key: string, windowMs = RATE_WINDOW_MS): void {
    const entry = this.buckets.get(key) ?? { stamps: [], windowMs };
    entry.stamps.push(Date.now());
    entry.windowMs = Math.max(entry.windowMs, windowMs);
    this.buckets.set(key, entry);
  }

  success(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.buckets) {
      const alive = entry.stamps.filter((stamp) => now - stamp <= entry.windowMs);
      if (alive.length === 0) {
        this.buckets.delete(key);
      } else if (alive.length !== entry.stamps.length) {
        entry.stamps = alive;
      }
    }
  }
}

export function resolveRoutePolicy(request: FastifyRequest): RouteAuthPolicy {
  const config = request.routeOptions?.config as { auth?: RouteAuthPolicy } | undefined;
  const declared = config?.auth;
  if (declared !== undefined) {
    return declared;
  }
  return request.url.startsWith('/api/') ? 'required' : 'public';
}

export function clientIpHash(request: FastifyRequest, salt: string): string | null {
  if (salt === '') return null;
  const ip = request.ip;
  if (ip === undefined || ip === '') return null;
  return createHash('sha256').update(salt + ip).digest('hex');
}

function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === '') {
    return true; // non-browser client (curl/CLI) — still CSRF-token protected
  }
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  cookieToken: string,
  secureMode: 'auto' | 'always',
): void {
  void reply.setCookie(SESSION_COOKIE, cookieToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // spec 2.5: auto = Secure when the request itself is HTTPS (trusted
    // proxy already honored by Fastify); 'always' for TLS-terminated setups.
    secure: secureMode === 'always' || request.protocol === 'https',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

async function fastifyAuthPlugin(
  app: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  const { store, lifetimes } = options;
  const lastTouch = new Map<string, number>();

  app.register(cookiePlugin);
  app.decorateRequest('auth', {
    getter() {
      return this.requestAuthState ?? { session: null, user: null, recent: false };
    },
    setter(value) {
      this.requestAuthState = value;
    },
  });
  app.decorateRequest('requestAuthState', null);

  // Central policy enforcement at onRequest: auth must run BEFORE body
  // validation so protected routes never leak schema/validation errors to
  // anonymous callers (spec 2.9 deny-by-default). The session is resolved
  // for EVERY route — public ones (like /api/auth/state) still need to know
  // who is calling; they just do not require it.
  app.addHook('onRequest', async (request, reply) => {
    const cookieToken = request.cookies[SESSION_COOKIE];
    let session: SessionRow | null = null;
    let sessionExistsButInvalid = false;
    let user: UserRow | null = null;
    if (cookieToken !== undefined && cookieToken !== '') {
      const row = store.getSessionByTokenHash(createHash('sha256').update(cookieToken).digest('hex'));
      const now = Date.now();
      if (row !== undefined) {
        if (
          row.revoked_at === null &&
          row.idle_expires_at > now &&
          row.absolute_expires_at > now
        ) {
          const candidateUser = store.getUserById(row.user_id);
          if (candidateUser !== undefined && candidateUser.disabled_at === null) {
            session = row;
            user = candidateUser;
          }
        } else {
          sessionExistsButInvalid = true;
        }
      }
      if (process.env.AUTH_DEBUG === '1') {
        console.log(`[auth-debug] ${request.method} ${request.url} cookie=${cookieToken.slice(0, 8)}… rowFound=${row !== undefined} session=${session !== null} invalid=${sessionExistsButInvalid}`);
      }
    }
    request.requestAuthState = {
      session,
      user,
      recent:
        session !== null &&
        session.reauth_until !== null &&
        session.reauth_until > Date.now(),
    };

    // Origin validation applies to EVERY mutation — public or not — so
    // cross-origin browser posts to /login or /setup are rejected too
    // (spec 2.13). Non-browser clients (no Origin header) are unaffected.
    const method = request.method.toUpperCase();
    const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isMutation && !originAllowed(request)) {
      void reply.code(403).send({
        error: {
          code: 'AUTH_CSRF_INVALID',
          message: 'Cross-origin mutation rejected.',
          details: {},
          requestId: request.id,
        },
      });
      return reply;
    }

    const policy = resolveRoutePolicy(request);
    if (policy === 'public') {
      return;
    }

    if (session === null || user === null) {
      void reply.code(401).send({
        error: {
          code:
            sessionExistsButInvalid || session !== null
              ? 'AUTH_SESSION_EXPIRED'
              : 'AUTH_REQUIRED',
          message:
            sessionExistsButInvalid || session !== null
              ? 'Your session has expired.'
              : 'Authentication required.',
          details: {},
          requestId: request.id,
        },
      });
      return reply;
    }

    // Throttled session touch (spec 2.6): at most one write per 5 minutes.
    const now = Date.now();
    const last = lastTouch.get(session.id) ?? 0;
    if (now - last > 5 * 60 * 1000) {
      store.touchSession(session.id, now, now + lifetimes.idleMs);
      lastTouch.set(session.id, now);
    }

    request.auth = {
      session,
      user,
      recent: session.reauth_until === null || session.reauth_until > now,
    };

    if (policy === 'recent' && !request.auth.recent) {
      void reply.code(401).send({
        error: {
          code: 'AUTH_REAUTH_REQUIRED',
          message: 'Re-authentication is required for this action.',
          details: {},
          requestId: request.id,
        },
      });
      return reply;
    }

    // CSRF for mutations (spec 2.12/2.13): session-bound token + same origin.
    if (isMutation) {
      const header = request.headers[CSRF_HEADER];
      if (
        typeof header !== 'string' ||
        !constantTimeEqual(header, session.csrf_token)
      ) {
        void reply.code(403).send({
          error: {
            code: 'AUTH_CSRF_INVALID',
            message: 'Missing or invalid CSRF token.',
            details: {},
            requestId: request.id,
          },
        });
        return reply;
      }
    }
  });

  // Security headers (spec 2.23) on every reply.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  // Session invalidation: abort streams bound to the session (spec 2.18).
  const sessionStreams = new Map<string, Set<() => void>>();
  app.decorate('registerSessionStream', (sessionId: string, abort: () => void) => {
    const set = sessionStreams.get(sessionId) ?? new Set<() => void>();
    set.add(abort);
    sessionStreams.set(sessionId, set);
    // Unregister keeps the registry from leaking after normal stream close.
    return () => {
      sessionStreams.get(sessionId)?.delete(abort);
    };
  });
  app.decorate('invalidateSessionStreams', (sessionId: string) => {
    const set = sessionStreams.get(sessionId);
    if (set !== undefined) {
      for (const abort of set) {
        abort();
      }
      sessionStreams.delete(sessionId);
    }
    options.onSessionInvalidated?.(sessionId);
    lastTouch.delete(sessionId);
  });
}

export const authPlugin = fp(fastifyAuthPlugin, { name: 'auth-policy' });

/** Session-scoped CSRF exposure for the frontend (spec 2.12). */
export function currentCsrfToken(request: FastifyRequest): string | null {
  return request.auth?.session?.csrf_token ?? null;
}

export function newIpHashSalt(): string {
  return randomBytes(16).toString('hex');
}
