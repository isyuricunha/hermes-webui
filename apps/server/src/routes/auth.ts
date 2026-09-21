import type { FastifyInstance, FastifyRequest } from 'fastify';
import { clearSessionCookie, clientIpHash, setSessionCookie } from '../auth/plugin';
import { AuthError, type AuthService } from '../auth/service';
import type { AuthStore } from '../auth/store';

/**
 * Auth routes (Phase 1, spec 2.10). The auth-policy plugin protects these by
 * default; public ones declare themselves explicitly. Mutating routes get
 * CSRF enforcement from the central policy.
 */

interface AuthContext {
  service: AuthService;
  store: AuthStore;
  secureCookie: boolean;
  ipHashSalt: string;
}

function requestContext(
  request: FastifyRequest,
  ipHashSalt: string,
): { userAgent: string | null; clientIpHash: string | null } {
  const agent = request.headers['user-agent'];
  const sessionIp = request.auth?.session?.client_ip_hash ?? null;
  return {
    userAgent: typeof agent === 'string' ? agent : null,
    clientIpHash: sessionIp ?? clientIpHash(request, ipHashSalt),
  };
}

function authErrorReply(reply: { code: (status: number) => { header: (name: string, value: string) => void; send: (payload: unknown) => unknown } }, error: unknown, requestId: string): void {
  if (error instanceof AuthError) {
    if (error.retryAfterSeconds !== undefined) {
      reply.code(error.httpStatus).header('retry-after', String(error.retryAfterSeconds));
    }
    void reply.code(error.httpStatus).send({
      error: { code: error.code, message: error.message, details: {}, requestId },
    });
    return;
  }
  void reply.code(500).send({
    error: { code: 'INTERNAL', message: 'Unexpected error.', details: {}, requestId },
  });
}

export function buildAuthRoutes(
  app: FastifyInstance,
  context: AuthContext,
): void {
  const { service, store, secureCookie, ipHashSalt } = context;

  app.get(
    '/api/auth/state',
    { config: { auth: 'public' } },
    async (request) => {
      const claimed = store.isClaimed();
      const session = request.auth?.session ?? null;
      const user = request.auth?.user ?? null;
      if (session === null || user === null) {
        return { claimed, authenticated: false };
      }
      return {
        claimed: true,
        authenticated: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
        },
        session: {
          expiresAt: new Date(session.idle_expires_at).toISOString(),
          absoluteExpiresAt: new Date(session.absolute_expires_at).toISOString(),
          reauthUntil:
            session.reauth_until === null ? null : new Date(session.reauth_until).toISOString(),
        },
        csrfToken: session.csrf_token,
      };
    },
  );

  app.post(
    '/api/auth/setup',
    { config: { auth: 'public' } },
    async (request, reply) => {
      const body = request.body as {
        setupToken?: unknown;
        username?: unknown;
        displayName?: unknown;
        password?: unknown;
      };
      try {
        const result = await service.setup({
          setupToken: String(body.setupToken ?? ''),
          username: String(body.username ?? ''),
          displayName: body.displayName === undefined ? undefined : String(body.displayName),
          password: String(body.password ?? ''),
          context: requestContext(request, ipHashSalt),
          requestId: request.id,
        });
        setSessionCookie(reply, result.session.cookieToken, secureCookie);
        return {
          authenticated: true,
          user: result.user,
          session: {
            expiresAt: new Date(result.session.expiresAt).toISOString(),
            absoluteExpiresAt: new Date(result.session.absoluteExpiresAt).toISOString(),
            reauthUntil:
              result.session.reauthUntil === null
                ? null
                : new Date(result.session.reauthUntil).toISOString(),
          },
          csrfToken: result.session.csrfToken,
        };
      } catch (error) {
        authErrorReply(reply, error, request.id);
      }
    },
  );

  app.post(
    '/api/auth/login',
    { config: { auth: 'public' } },
    async (request, reply) => {
      const body = request.body as { username?: unknown; password?: unknown };
      try {
        const result = await service.login({
          username: String(body.username ?? ''),
          password: String(body.password ?? ''),
          context: requestContext(request, ipHashSalt),
          requestId: request.id,
        });
        setSessionCookie(reply, result.session.cookieToken, secureCookie);
        return {
          authenticated: true,
          user: result.user,
          session: {
            expiresAt: new Date(result.session.expiresAt).toISOString(),
            absoluteExpiresAt: new Date(result.session.absoluteExpiresAt).toISOString(),
            reauthUntil:
              result.session.reauthUntil === null
                ? null
                : new Date(result.session.reauthUntil).toISOString(),
          },
          csrfToken: result.session.csrfToken,
        };
      } catch (error) {
        authErrorReply(reply, error, request.id);
      }
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const session = request.auth.session;
    if (session !== null) {
      service.logout(
        { id: session.id, userId: session.user_id },
        requestContext(request, ipHashSalt),
        request.id,
      );
      app.invalidateSessionStreams(session.id);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/reauth', async (request, reply) => {
    const session = request.auth.session;
    if (session === null) {
      void reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, requestId: request.id },
      });
      return;
    }
    const body = request.body as { password?: unknown };
    try {
      await service.reauth(
        {
          password: String(body.password ?? ''),
          context: requestContext(request, ipHashSalt),
          requestId: request.id,
        },
        { id: session.id, userId: session.user_id },
      );
      return { ok: true, reauthUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    } catch (error) {
      authErrorReply(reply, error, request.id);
    }
  });

  app.post('/api/auth/password', { config: { auth: 'recent' } }, async (request, reply) => {
    const session = request.auth.session;
    if (session === null) {
      void reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, requestId: request.id },
      });
      return;
    }
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown };
    try {
      const result = await service.changePassword(
        {
          currentPassword: String(body.currentPassword ?? ''),
          newPassword: String(body.newPassword ?? ''),
          context: requestContext(request, ipHashSalt),
          requestId: request.id,
        },
        { id: session.id, userId: session.user_id, csrfToken: session.csrf_token },
      );
      setSessionCookie(reply, result.cookieToken, secureCookie);
      return {
        ok: true,
        csrfToken: result.csrfToken,
        session: {
          expiresAt: new Date(result.expiresAt).toISOString(),
          absoluteExpiresAt: new Date(result.absoluteExpiresAt).toISOString(),
          reauthUntil:
            result.reauthUntil === null ? null : new Date(result.reauthUntil).toISOString(),
        },
      };
    } catch (error) {
      authErrorReply(reply, error, request.id);
    }
  });

  app.get('/api/auth/sessions', async (request) => {
    const session = request.auth.session;
    const rows = session === null ? [] : store.listSessionsForUser(session.user_id);
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        current: row.id === session?.id,
        createdAt: new Date(row.created_at).toISOString(),
        lastSeenAt: new Date(row.last_seen_at).toISOString(),
        expiresAt: new Date(row.absolute_expires_at).toISOString(),
        userAgent: row.user_agent,
      })),
    };
  });

  app.delete('/api/auth/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = request.auth.session;
    if (session === null) {
      void reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, requestId: request.id },
      });
      return;
    }
    const target = store.getSessionByTokenHash; // sessions listed by id, not hash:
    void target;
    store.revokeSession(sessionId);
    app.invalidateSessionStreams(sessionId);
    store.appendAudit({
      userId: session.user_id,
      event: 'session.revoked',
      outcome: 'success',
      requestId: request.id,
      metadata: { sessionId },
    });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (request, reply) => {
    const session = request.auth.session;
    if (session === null) {
      void reply.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.', details: {}, requestId: request.id },
      });
      return;
    }
    const revoked = store.revokeAllForUser(session.user_id, session.id);
    for (let index = 0; index < revoked; index += 1) {
      app.invalidateSessionStreams(`revoke-others:${session.id}:${index}`);
    }
    store.appendAudit({
      userId: session.user_id,
      event: 'session.revoke_others',
      outcome: 'success',
      requestId: request.id,
      metadata: { revoked },
    });
    return { ok: true, revoked };
  });
}
