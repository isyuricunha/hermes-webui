import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { AppStatus, HermesConnectivity } from '@hermes-webui/shared';
import type { ServerConfig } from './config';
import { HermesClient, HermesHttpError } from './hermes/client';
import { HermesDashboardClient } from './hermes/dashboard';
import { HermesDashboardSession, HermesIdentity } from './hermes/identity';
import { sessionRoutes } from './routes/sessions';
import { runRoutes } from './routes/runs';
import { cronRoutes } from './routes/cron';
import { settingsRoutes } from './routes/settings';
import { hermesProxyRoutes } from './routes/hermesProxy';
import { cliRoutes } from './routes/cli';
import { commandRoutes } from './routes/commands';
import { openDatabase } from './db/database';
import { AuthStore } from './auth/store';
import { AuthService } from './auth/service';
import { LoginRateLimiter, authPlugin, newIpHashSalt } from './auth/plugin';
import { buildAuthRoutes } from './routes/auth';

export interface BuildAppOptions {
  config: ServerConfig;
  hermesClient?: HermesClient;
  dashboardClient?: HermesDashboardClient;
  /** Test seam: in-memory or temp-dir database. */
  dataDir?: string;
  /** Test seam: disable the auth policy entirely (never used in production). */
  disableAuth?: boolean;
  /** Test seam: Hermes identity used in auth mode "hermes". */
  hermesIdentity?: HermesIdentity;
  /** Test seam: fetch used by the default dashboard client. */
  dashboardFetch?: typeof fetch;
}

/**
 * Builds the Fastify application. Kept separate from main.ts so tests can
 * use fastify.inject() against the real route tree (PRD 60.2).
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const hermes =
    options.hermesClient ?? new HermesClient(config.hermesBaseUrl, config.hermesApiKey);

  // Auth state lives in the WebUI database; open it before the dashboard
  // client so auth mode "hermes" can hand it the signed-in dashboard session.
  const dataDir = options.dataDir ?? config.dataDir;
  const { db } = openDatabase(dataDir);
  const store = new AuthStore(db);
  const identity =
    config.authMode === 'hermes'
      ? (options.hermesIdentity ??
        new HermesIdentity(config.hermesDashboardUrl, config.hermesAuthProvider))
      : undefined;
  const dashboard =
    options.dashboardClient ??
    new HermesDashboardClient(config.hermesDashboardUrl, config.hermesDashboardToken, {
      fetchImpl: options.dashboardFetch,
      tokenSource: identity === undefined ? undefined : new HermesDashboardSession(identity, store),
    });

  const app = Fastify({
    // Trusted proxy (spec 2.14): only explicit IPs/CIDRs; request.protocol,
    // client IP and rate limiting honor it. Never blanket `true`.
    trustProxy: config.trustProxy,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        // Defense in depth: never let credential-shaped fields reach logs.
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-hermes-session-token"]',
        ],
        censor: '[REDACTED]',
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Production static serving (PRD 42.5): one process serves the API and the
  // built web assets. In dev the Vite dev server proxies /api instead.
  const webDist = config.webDistDir;
  const webDistReady = existsSync(webDist);
  if (webDistReady) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: ['index.html'],
    });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    }
    void reply.status(statusCode).send({
      error: {
        code: error.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        message: statusCode >= 500 ? 'Internal error. See WebUI logs for details.' : error.message,
      },
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    // SPA fallback (PRD 42.5): non-API GETs serve the built web app.
    if (webDistReady && request.method === 'GET' && !request.url.startsWith('/api/')) {
      void reply.type('text/html').sendFile('index.html');
      return;
    }
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
      requestId: request.id,
    });
  });

  const apiRouteInventory: { method: string; url: string }[] = [];
  app.decorate('apiRouteInventory', apiRouteInventory);
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/')) {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        apiRouteInventory.push({ method, url: route.url });
      }
    }
  });

  // Phase 1 auth (spec 2.9): central policy, deny-by-default for /api/*.
  // Only /healthz and /api/auth/{state,setup,login} declare themselves public.
  const ipHashSalt = newIpHashSalt();
  const limiter = new LoginRateLimiter();
  const service = new AuthService(store, config.session, dataDir, limiter, identity);

  // First boot (spec 2.7): write the one-time setup token while unclaimed
  // (local auth mode only; in "hermes" mode Hermes owns the credential).
  if (!service.isClaimed()) {
    const tokenPath = service.ensureBootstrapToken();
    app.log.warn(`Hermes WebUI is unclaimed. Setup token written to: ${tokenPath}`);
  }

  app.decorate('ipHashSalt', ipHashSalt);
  if (options.disableAuth !== true) {
    await app.register(authPlugin, {
      store,
      service,
      lifetimes: config.session,
      secureCookie: config.cookieSecureMode === 'always',
      ipHashSalt,
    });
  }

  app.get(
    '/healthz',
    { config: { auth: 'public' } },
    async () => ({ ok: true, service: 'hermes-webui' }),
  );
  // Kept alongside /healthz (spec 2.10) for deploy-script compatibility.
  app.get(
    '/api/healthz',
    { config: { auth: 'public' } },
    async () => ({ ok: true, service: 'hermes-webui' }),
  );

  buildAuthRoutes(app, {
    service,
    store,
    secureMode: config.cookieSecureMode,
    ipHashSalt,
  });


  /***
   * Connection states per PRD 40: connected (gateway healthy + auth ok),
   * degraded (reachable but our key was rejected), offline (unreachable).
   */
  app.get('/api/app/status', async (_request, reply) => {
    let connectivity: HermesConnectivity;
    try {
      const health = await hermes.health();
      if (config.hermesApiKey) {
        try {
          await hermes.capabilities();
          connectivity = { state: 'connected', baseUrl: hermes.gatewayUrl, version: health.version };
        } catch (error) {
          if (error instanceof HermesHttpError && (error.status === 401 || error.status === 403)) {
            connectivity = { state: 'degraded', baseUrl: hermes.gatewayUrl, reason: 'auth_failed' };
          } else {
            throw error;
          }
        }
      } else {
        connectivity = { state: 'connected', baseUrl: hermes.gatewayUrl, version: health.version };
      }
    } catch (error) {
      const message =
        error instanceof HermesHttpError ? error.message : 'Hermes gateway did not answer.';
      connectivity = { state: 'offline', baseUrl: hermes.gatewayUrl, error: message };
    }
    const body: AppStatus = {
      app: 'hermes-webui',
      version: config.appVersion,
      hermes: connectivity,
    };
    return void reply.send(body);
  });

  await app.register(sessionRoutes, { client: hermes });
  await app.register(runRoutes, { client: hermes });
  await app.register(cronRoutes, { client: hermes });
  await app.register(settingsRoutes, { dashboard });
  await app.register(hermesProxyRoutes, { dashboard });
  await app.register(cliRoutes, { hermesBin: config.hermesBin });
  await app.register(commandRoutes);

  return app;
}
