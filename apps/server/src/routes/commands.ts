import type { FastifyInstance } from 'fastify';
import { commandCatalog } from '../hermes/commands';
import { HermesHttpError } from '../hermes/client';
import { SLASH_COMMAND, SlashBridgeError, type HermesSlashBridge } from '../hermes/slashBridge';

/**
 * GET /api/commands — normalized Hermes command catalog for the WebUI
 * slash palette. Static derived data (see hermes-commands.json provenance);
 * no Hermes round-trip needed per request.
 *
 * POST /api/commands/exec — runs one slash command in Hermes (see
 * hermes/slashBridge.ts). Session auth and CSRF come from the /api policy.
 */
export async function commandRoutes(
  app: FastifyInstance,
  opts: { slash?: HermesSlashBridge },
): Promise<void> {
  app.get('/api/commands', async (_request, reply) => {
    return reply.send({
      commands: commandCatalog(),
    });
  });

  app.post(
    '/api/commands/exec',
    {
      schema: {
        body: {
          type: 'object',
          required: ['command'],
          additionalProperties: false,
          properties: {
            command: { type: 'string', minLength: 2, maxLength: 4100, pattern: SLASH_COMMAND.source },
            sessionId: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const { command, sessionId } = request.body as { command: string; sessionId?: string };
      if (opts.slash === undefined) {
        return reply.status(503).send({
          error: { code: 'SLASH_BRIDGE_UNAVAILABLE', message: 'Hermes commands are not available on this server.' },
          requestId: request.id,
        });
      }
      try {
        return await reply.header('cache-control', 'no-store').send(await opts.slash.exec(command.trim(), sessionId));
      } catch (error) {
        if (error instanceof SlashBridgeError) {
          return reply.status(error.code === 'SLASH_BRIDGE_TIMEOUT' ? 504 : 503).send({
            error: { code: error.code, message: error.message },
            requestId: request.id,
          });
        }
        if (error instanceof HermesHttpError) {
          return reply.status(502).send({
            error: { code: 'SLASH_BRIDGE_UNAVAILABLE', message: `Hermes commands need the dashboard: ${error.message}` },
            requestId: request.id,
          });
        }
        throw error;
      }
    },
  );
}
