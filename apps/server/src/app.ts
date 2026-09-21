import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppStatus, HermesConnectivity } from '@hermes-webui/shared';
import type { ServerConfig } from './config';
import { HermesClient, HermesHttpError } from './hermes/client';
import { HermesDashboardClient } from './hermes/dashboard';
import { sessionRoutes } from './routes/sessions';
import { runRoutes } from './routes/runs';
import { cronRoutes } from './routes/cron';
import { settingsRoutes } from './routes/settings';
import { cliRoutes } from './routes/cli';

export interface BuildAppOptions {
  config: ServerConfig;
  hermesClient?: HermesClient;
  dashboardClient?: HermesDashboardClient;
}

/**
 * Builds the Fastify application. Kept separate from main.ts so tests can
 * use fastify.inject() against the real route tree (PRD 60.2).
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const hermes =
    options.hermesClient ?? new HermesClient(config.hermesBaseUrl, config.hermesApiKey);
  const dashboard =
    options.dashboardClient ??
    new HermesDashboardClient(config.hermesDashboardUrl, config.hermesDashboardToken);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        // Defense in depth: never let credential-shaped fields reach logs.
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-hermes-session-token"]'],
        censor: '[REDACTED]',
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

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
    void reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${request.method} ${request.url}`,
      },
      requestId: request.id,
    });
  });

  app.get('/api/healthz', async () => ({ ok: true }));

  /**
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
  await app.register(cliRoutes, { hermesBin: config.hermesBin });

  return app;
}
