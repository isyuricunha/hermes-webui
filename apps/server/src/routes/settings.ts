import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
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
  opts: { dashboard: HermesDashboardClient; gateway?: HermesClient },
): Promise<void> {
  const { dashboard, gateway } = opts;

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

  // Mutating: deep-merge write over the real config.yaml (PRD 77). The UI
  // re-reads after saving to confirm the change landed.
  app.put(
    '/api/settings/config',
    {
      schema: {
        body: {
          type: 'object',
          required: ['config'],
          properties: { config: { type: 'object' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { config: patch } = request.body as { config: Record<string, unknown> };
        return await reply.send(await dashboard.putConfig(patch));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

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

  // Mutating: toggles enabled on the real config (applies next session).
  app.put(
    '/api/settings/mcp/servers/:name/enabled',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      try {
        const { enabled } = request.body as { enabled: boolean };
        request.log.warn({ action: 'mcp.enabled', name, enabled }, 'mcp server toggle');
        return await reply.send(await dashboard.setMcpServerEnabled(name, enabled));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.post('/api/settings/mcp/servers/:name/test', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      return await reply.send(await dashboard.testMcpServer(name));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  // Mutating: assigns the main model slot (PRD 22.2). May return
  // confirm_required for expensive models — the UI surfaces the warning.
  app.post(
    '/api/settings/model/set',
    {
      schema: {
        body: {
          type: 'object',
          required: ['scope', 'model'],
          properties: {
            scope: { enum: ['main', 'auxiliary'] },
            provider: { type: 'string' },
            model: { type: 'string', minLength: 1 },
            confirm_expensive_model: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          scope: 'main' | 'auxiliary';
          provider?: string;
          model: string;
          confirm_expensive_model?: boolean;
        };
        request.log.warn({ action: 'model.set', model: body.model }, 'model assignment via WebUI');
        return await reply.send(await dashboard.setModelAssignment(body));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.get('/api/settings/skills', async (request, reply) => {
    try {
      return await reply.send(await dashboard.listSkills());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/settings/messaging/platforms', async (request, reply) => {
    try {
      const [platforms, live] = await Promise.all([
        dashboard.messagingPlatforms(),
        gateway?.healthDetailed().catch(() => null) ?? Promise.resolve(null),
      ]);
      return await reply.send(withLiveStates(platforms, live));
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
      const count =
        lines !== undefined && Number.isFinite(Number(lines)) && Number(lines) > 0
          ? Math.min(Number(lines), 500)
          : 50;
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

/**
 * The dashboard judges a channel from gateway_state.json and sometimes calls
 * a connected one "pending_restart" (its liveness ladder misses the running
 * gateway). The gateway's own /health/detailed is the live truth, so a
 * channel the gateway reports connected or failing wins over that guess.
 */
export function withLiveStates(platforms: unknown, live: unknown): unknown {
  if (platforms === null || typeof platforms !== 'object') return platforms;
  const list = (platforms as { platforms?: unknown }).platforms;
  if (!Array.isArray(list)) return platforms;
  const liveRecord = (live ?? {}) as { gateway?: { platforms?: unknown }; platforms?: unknown };
  const liveMap = (liveRecord.gateway?.platforms ?? liveRecord.platforms ?? {}) as Record<string, unknown>;
  if (liveMap === null || typeof liveMap !== 'object') return platforms;
  const guessed = new Set(['pending_restart', 'gateway_stopped']);
  return {
    ...platforms,
    platforms: list.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const platform = entry as Record<string, unknown>;
      const state = liveMap[String(platform.id)];
      if (state === null || typeof state !== 'object') return platform;
      const liveState = (state as { state?: unknown }).state;
      if (typeof liveState !== 'string' || liveState === '') return platform;
      if (platform.enabled !== true || platform.configured !== true) return platform;
      if (!guessed.has(String(platform.state))) return platform;
      const liveError = state as { error_code?: unknown; error_message?: unknown };
      return {
        ...platform,
        state: liveState,
        gateway_running: true,
        error_code: typeof liveError.error_code === 'string' ? liveError.error_code : null,
        error_message: typeof liveError.error_message === 'string' ? liveError.error_message : null,
      };
    }),
  };
}
