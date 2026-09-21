import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppStatus } from '@hermes-webui/shared';
import type { ServerConfig } from './config';
import { HermesClient } from './hermes/client';

export interface BuildAppOptions {
  config: ServerConfig;
  hermesClient?: HermesClient;
}

/**
 * Builds the Fastify application. Kept separate from main.ts so tests can
 * use fastify.inject() against the real route tree (PRD 60.2).
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const hermes = options.hermesClient ?? new HermesClient(config.hermesBaseUrl);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        // Defense in depth: never let credential-shaped fields reach logs.
        paths: ['req.headers.authorization', 'req.headers.cookie'],
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

  app.get<{ Reply: AppStatus }>('/api/app/status', async (_request, reply) => {
    const probe = await hermes.checkReachable();
    const body: AppStatus = {
      app: 'hermes-webui',
      version: config.appVersion,
      hermes:
        probe.reachable
          ? { state: 'connected', baseUrl: hermes.baseUrl, probe: probe.probe }
          : { state: 'offline', baseUrl: hermes.baseUrl, error: probe.error },
    };
    return void reply.send(body);
  });

  return app;
}
