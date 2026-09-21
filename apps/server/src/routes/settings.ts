import type { FastifyInstance } from 'fastify';
import type { HermesDashboardClient } from '../hermes/dashboard';
import { sendHermesError } from '../hermes/errors';

/**
 * Settings workspace routes (PRD 19-32, Phase 3). Everything here proxies the
 * dashboard API over loopback: config reads/writes, env/secrets, models,
 * MCP, skills, messaging and ops. Mutations pass through to Hermes, which
 * remains the source of truth.
 *
 * Capability note (Yuri's directive): when the dashboard is unavailable these
 * routes degrade (503 HERMES_DASHBOARD_UNREACHABLE) and the UI shows the area
 * as unavailable instead of breaking the app.
 */
export async function settingsRoutes(
  app: FastifyInstance,
  opts: { dashboard: HermesDashboardClient },
): Promise<void> {
  const dashboard = opts.dashboard;

  // -- Config -----------------------------------------------------------------

  app.get('/api/settings/config/raw', async (request, reply) => {
    try {
      return await reply.send(await dashboard.getConfigRaw());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.put(
    '/api/settings/config/raw',
    {
      schema: {
        body: {
          type: 'object',
          required: ['yaml_text'],
          properties: { yaml_text: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { yaml_text } = request.body as { yaml_text: string };
        return await reply.send(await dashboard.putConfigRaw(yaml_text));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.get('/api/settings/config', async (request, reply) => {
    try {
      return await reply.send(await dashboard.getConfig());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/schema', async (request, reply) => {
    try {
      return await reply.send(await dashboard.getSchema());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/defaults', async (request, reply) => {
    try {
      return await reply.send(await dashboard.getDefaults());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  // -- Environment / secrets --------------------------------------------------

  app.get('/api/settings/env', async (request, reply) => {
    try {
      return await reply.send(await dashboard.listEnv());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.put(
    '/api/settings/env',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'value'],
          properties: { key: { type: 'string', minLength: 1 }, value: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { key, value } = request.body as { key: string; value: string };
        return await reply.send(await dashboard.putEnv(key, value));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.delete(
    '/api/settings/env',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { key } = request.body as { key: string };
        return await reply.send(await dashboard.deleteEnv(key));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  // -- Models / MCP / Skills / Messaging ---------------------------------------

  app.get('/api/settings/model/info', async (request, reply) => {
    try {
      return await reply.send(await dashboard.modelInfo());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/model/options', async (request, reply) => {
    try {
      return await reply.send(await dashboard.modelOptions());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/mcp/servers', async (request, reply) => {
    try {
      return await reply.send(await dashboard.listMcpServers());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/skills', async (request, reply) => {
    try {
      return await reply.send(await dashboard.listSkills());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/messaging/platforms', async (request, reply) => {
    try {
      return await reply.send(await dashboard.messagingPlatforms());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  // -- Ops --------------------------------------------------------------------

  app.post('/api/settings/ops/doctor', async (request, reply) => {
    try {
      return await reply.send(await dashboard.doctor());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/update/check', async (request, reply) => {
    try {
      return await reply.send(await dashboard.updateCheck());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  // Mutating: applies the update (git installs). DENY-BY-DEFAULT: Yuri's
  // install carries custom micro-patches, so update apply must never be
  // reachable unless the operator opts in explicitly.
  app.post('/api/settings/update/apply', async (request, reply) => {
    if (process.env.HERMES_WEBUI_ALLOW_UPDATE_APPLY !== '1') {
      return await reply.status(403).send({
        error: {
          code: 'UPDATE_APPLY_DISABLED',
          message:
            'Hermes update apply is disabled. This install is custom-patched; update it through its own flow. Set HERMES_WEBUI_ALLOW_UPDATE_APPLY=1 to enable.',
        },
        requestId: request.id,
      });
    }
    try {
      request.log.warn({ action: 'update.apply' }, 'hermes update requested via WebUI');
      return await reply.send(await dashboard.updateApply());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get<{
    Querystring: { file?: string; lines?: string };
  }>('/api/settings/logs', async (request, reply) => {
    try {
      const { file, lines } = request.query;
      const allowed = ['agent', 'gateway', 'errors'];
      const selected = file !== undefined && allowed.includes(file) ? file : 'agent';
      const count = lines !== undefined && Number.isFinite(Number(lines)) ? Math.min(Number(lines), 500) : 50;
      return await reply.send(await dashboard.logs(selected, count));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  // Mutating: restarts the Hermes gateway (systemd handoff). Confirmed in UI.
  app.post('/api/settings/gateway/restart', async (request, reply) => {
    try {
      request.log.warn({ action: 'gateway.restart' }, 'gateway restart requested via WebUI');
      return await reply.send(await dashboard.gatewayRestart());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });
}
