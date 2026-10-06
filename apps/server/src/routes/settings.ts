import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GuidedConfigOp } from '@hermes-webui/shared';
import type { HermesClient } from '../hermes/client';
import type { HermesDashboardClient } from '../hermes/dashboard';
import {
  ConfigEditError,
  applyConfigOps,
  backupConfigText,
  buildGuidedState,
  configRevision,
  toSchemaFields,
  validateConfigYaml,
  verifyApplied,
  type SchemaFields,
} from '../hermes/config-edit';
import { sendHermesError } from '../hermes/errors';

/** Config-edit failures keep their own code and status; anything else is a Hermes error. */
function sendConfigError(reply: FastifyReply, requestId: string, error: unknown): FastifyReply {
  if (error instanceof ConfigEditError) {
    return reply.status(error.status).send({ error: { code: error.code, message: error.message }, requestId });
  }
  return sendHermesError(reply, requestId, error);
}

const CONFIG_CHANGED_MESSAGE =
  'config.yaml was changed by something else since you opened it. Reload it so you do not overwrite that change.';

const SCHEMA_CACHE_MS = 60_000;

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
  opts: { dashboard: HermesDashboardClient; gateway?: HermesClient; dataDir: string },
): Promise<void> {
  const { dashboard, gateway, dataDir } = opts;

  // The schema is large and rarely changes; validating while someone types
  // must not refetch it on every pause.
  let configWriteTail = Promise.resolve();

  async function withConfigWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = configWriteTail;
    let release!: () => void;
    configWriteTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  let schemaCache: { at: number; fields: SchemaFields; categoryOrder: string[] } | null = null;
  async function loadSchema(): Promise<{ fields: SchemaFields; categoryOrder: string[] }> {
    if (schemaCache !== null && Date.now() - schemaCache.at < SCHEMA_CACHE_MS) {
      return schemaCache;
    }
    const schema = await dashboard.getSchema();
    schemaCache = { at: Date.now(), fields: toSchemaFields(schema.fields), categoryOrder: schema.category_order };
    return schemaCache;
  }

  // -- Config -----------------------------------------------------------------

  app.get('/api/settings/config/raw', async (request, reply) => {
    try {
      const raw = await dashboard.getConfigRaw();
      return await reply.send({ ...raw, rev: configRevision(raw.yaml) });
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post(
    '/api/settings/config/raw/validate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['yaml_text'],
          properties: { yaml_text: { type: 'string', maxLength: 2_000_000 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { yaml_text } = request.body as { yaml_text: string };
        const schema = await loadSchema();
        return await reply.send(validateConfigYaml(yaml_text, schema.fields));
      } catch (error) {
        return sendConfigError(reply, request.id, error);
      }
    },
  );

  app.put(
    '/api/settings/config/raw',
    {
      schema: {
        body: {
          type: 'object',
          required: ['yaml_text'],
          properties: {
            yaml_text: { type: 'string', maxLength: 2_000_000 },
            base_rev: { type: 'string', minLength: 1, maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        return await withConfigWriteLock(async () => {
          const { yaml_text, base_rev } = request.body as { yaml_text: string; base_rev?: string };
          const [current, schema] = await Promise.all([dashboard.getConfigRaw(), loadSchema()]);
        if (base_rev !== undefined && configRevision(current.yaml) !== base_rev) {
          throw new ConfigEditError('CONFIG_CHANGED', CONFIG_CHANGED_MESSAGE, 409);
        }
        const validation = validateConfigYaml(yaml_text, schema.fields);
        if (!validation.ok) {
          throw new ConfigEditError(
            'CONFIG_VALIDATION_FAILED',
            'config.yaml has blocking validation errors. Fix them before saving.',
            400,
          );
        }

        const latest = await dashboard.getConfigRaw();
        if (configRevision(latest.yaml) !== configRevision(current.yaml)) {
          throw new ConfigEditError('CONFIG_CHANGED', CONFIG_CHANGED_MESSAGE, 409);
        }

        if (yaml_text === latest.yaml) {
          return await reply.send({ ok: true, rev: configRevision(latest.yaml), validation });
        }

        await backupConfigText(dataDir, latest.yaml, 'raw');
        const written = await dashboard.putConfigRaw(yaml_text);
        const fresh = await dashboard.getConfigRaw();
          return await reply.send({ ...written, rev: configRevision(fresh.yaml), validation });
        });
      } catch (error) {
        return sendConfigError(reply, request.id, error);
      }
    },
  );

  app.get('/api/settings/config/guided', async (request, reply) => {
    try {
      const [raw, schema, config, defaults] = await Promise.all([
        dashboard.getConfigRaw(),
        loadSchema(),
        dashboard.getConfig(),
        dashboard.getDefaults(),
      ]);
      return await reply.send(buildGuidedState({ raw, schema, config, defaults }));
    } catch (error) {
      return sendConfigError(reply, request.id, error);
    }
  });

  app.put(
    '/api/settings/config/guided',
    {
      schema: {
        body: {
          type: 'object',
          required: ['rev', 'ops'],
          properties: {
            rev: { type: 'string', minLength: 1, maxLength: 64 },
            ops: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['op', 'path'],
                properties: {
                  op: { enum: ['set', 'unset'] },
                  path: { type: 'string', minLength: 1, maxLength: 512 },
                  value: {},
                  confirm: { type: 'boolean' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        return await withConfigWriteLock(async () => {
          const { rev, ops } = request.body as { rev: string; ops: GuidedConfigOp[] };
          const schema = await loadSchema();
          const current = await dashboard.getConfigRaw();

        if (configRevision(current.yaml) !== rev) {
          throw new ConfigEditError('CONFIG_CHANGED', CONFIG_CHANGED_MESSAGE, 409);
        }

        const defaults = await dashboard.getDefaults();
        const planned = applyConfigOps(current.yaml, ops, schema.fields, defaults);
        if (planned.applied.length === 0) {
          const [freshRaw, freshConfig] = await Promise.all([dashboard.getConfigRaw(), dashboard.getConfig()]);
          return await reply.send({
            ok: true,
            applied: [],
            skipped: planned.skipped,
            verified: true,
            mismatches: [],
            rev: configRevision(freshRaw.yaml),
            state: buildGuidedState({ raw: freshRaw, schema, config: freshConfig, defaults }),
          });
        }

        const latest = await dashboard.getConfigRaw();
        if (configRevision(latest.yaml) !== rev) {
          throw new ConfigEditError('CONFIG_CHANGED', CONFIG_CHANGED_MESSAGE, 409);
        }

        await backupConfigText(dataDir, latest.yaml, 'guided');
        await dashboard.putConfigRaw(planned.yaml);

        const [freshRaw, freshConfig] = await Promise.all([
          dashboard.getConfigRaw(),
          dashboard.getConfig(),
        ]);
        const mismatches = verifyApplied(planned.applied, ops, freshRaw.yaml, freshConfig);
        if (mismatches.length > 0) {
          throw new ConfigEditError(
            'CONFIG_VERIFY_FAILED',
            'Hermes reread the config but these changes did not land: ' + mismatches.join(', '),
            502,
          );
        }

          return await reply.send({
            ok: true,
            applied: planned.applied,
            skipped: planned.skipped,
            verified: true,
            mismatches: [],
            rev: configRevision(freshRaw.yaml),
            state: buildGuidedState({ raw: freshRaw, schema, config: freshConfig, defaults }),
          });
        });
      } catch (error) {
        return sendConfigError(reply, request.id, error);
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
      const [platforms, live, hub] = await Promise.all([
        dashboard.messagingPlatforms(),
        gateway?.healthDetailed().catch(() => null) ?? Promise.resolve(null),
        dashboard.pluginsHub().catch(() => null),
      ]);
      return await reply.send(withPlatformPlugins(withLiveStates(platforms, live), hub));
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

/**
 * Most channel adapters are bundled plugins now (plugins/platforms/<id>), and a
 * disabled plugin means the gateway never loads the adapter even with a valid
 * token (`hermes plugins enable platforms/discord`). Each channel gets
 * `plugin: { name, enabled }` when an adapter plugin backs it, null otherwise.
 */
/** Plugins that register more than one platform. */
const SHARED_PLUGIN: Record<string, string> = { wecom_callback: 'wecom' };

export function withPlatformPlugins(platforms: unknown, hub: unknown): unknown {
  if (platforms === null || typeof platforms !== 'object') return platforms;
  const list = (platforms as { platforms?: unknown }).platforms;
  const plugins = (hub as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(list) || !Array.isArray(plugins)) return platforms;
  const byDir = new Map<string, { name: string; enabled: boolean }>();
  for (const entry of plugins) {
    if (entry === null || typeof entry !== 'object') continue;
    const plugin = entry as { name?: unknown; path?: unknown; runtime_status?: unknown };
    const match = typeof plugin.path === 'string' ? /\/plugins\/platforms\/([^/]+)\/?$/.exec(plugin.path) : null;
    if (match === null || typeof plugin.name !== 'string') continue;
    byDir.set(match[1]!, { name: plugin.name, enabled: plugin.runtime_status === 'enabled' });
  }
  return {
    ...platforms,
    platforms: list.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const id = String((entry as { id?: unknown }).id ?? '');
      const plugin = byDir.get(id) ?? byDir.get(SHARED_PLUGIN[id] ?? '') ?? null;
      return { ...entry, plugin };
    }),
  };
}
