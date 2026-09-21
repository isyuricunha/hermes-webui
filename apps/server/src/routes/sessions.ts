import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
import { sendHermesError } from '../hermes/errors';

/**
 * Session management routes (PRD 11). Thin proxies over the gateway's
 * /api/sessions resources: Hermes owns the sessions; the WebUI only renders
 * and forwards operations.
 */
export async function sessionRoutes(
  app: FastifyInstance,
  opts: { client: HermesClient },
): Promise<void> {
  const client = opts.client;
  app.get('/api/sessions', async (request, reply) => {
    try {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      const payload = await client.listSessions({
        limit: limit !== undefined && limit !== '' ? Number(limit) : undefined,
        offset: offset !== undefined && offset !== '' ? Number(offset) : undefined,
      });
      return await reply.send(payload);
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post(
    '/api/sessions',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            system_prompt: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const payload = await client.createSession(request.body as Record<string, unknown>);
        return await reply.send(payload);
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      return await reply.send(await client.getSession(sessionId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.patch(
    '/api/sessions/:sessionId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            pinned: { type: 'boolean' },
            archived: { type: 'boolean' },
            hidden: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      try {
        return await reply.send(await client.patchSession(sessionId, request.body as Record<string, unknown>));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      return await reply.send(await client.deleteSession(sessionId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      return await reply.send(await client.getSessionMessages(sessionId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/sessions/:sessionId/fork', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      return await reply.send(await client.forkSession(sessionId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });
}
