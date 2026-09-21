import type { FastifyInstance } from 'fastify';
import { commandCatalog } from '../hermes/commands';

/**
 * GET /api/commands — normalized Hermes command catalog for the WebUI
 * slash palette. Static derived data (see hermes-commands.json provenance);
 * no Hermes round-trip needed per request.
 */
export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/commands', async (_request, reply) => {
    return reply.send({
      commands: commandCatalog(),
    });
  });
}
