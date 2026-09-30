import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
import { sendHermesError } from '../hermes/errors';
import type { MessageImageStore } from '../images';

/**
 * Session management routes (PRD 11). Thin proxies over the gateway's
 * /api/sessions resources: Hermes owns the sessions; the WebUI only renders
 * and forwards operations.
 */
export async function sessionRoutes(
  app: FastifyInstance,
  opts: { client: HermesClient; images?: MessageImageStore },
): Promise<void> {
  const client = opts.client;

  // Images this WebUI sent in the session (Hermes keeps only "[screenshot]").
  app.get('/api/sessions/:sessionId/images', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    return await reply.header('cache-control', 'no-store').send({ images: opts.images?.list(sessionId) ?? [] });
  });

  app.get('/api/images/:imageId', async (request, reply) => {
    const id = Number((request.params as { imageId: string }).imageId);
    const image = Number.isInteger(id) && id > 0 ? opts.images?.get(id) : undefined;
    if (image === undefined) {
      return await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Image not found.' }, requestId: request.id });
    }
    return await reply
      .header('content-type', image.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-security-policy', "sandbox; default-src 'none'; frame-ancestors 'none'")
      .send(image.data);
  });

  // Session-scoped model lock (gateway POST /api/sessions/:id/model). This is
  // the ONLY supported model change from a chat session; global changes go
  // through Settings and are never triggered from here.
  app.get('/api/sessions/:sessionId/model', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      const session = await client.getSession(sessionId);
      return await reply.send({
        model: (session.model as string | undefined) ?? null,
        provider: (session.provider as string | undefined) ?? null,
      });
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.put(
    '/api/sessions/:sessionId/model',
    {
      schema: {
        body: {
          type: 'object',
          required: ['model'],
          properties: {
            model: { type: 'string', minLength: 1 },
            provider: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const { model, provider } = request.body as { model: string; provider?: string };
      try {
        const payload = await client.lockSessionModel(sessionId, { model, provider });
        return await reply.send(payload);
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.get('/api/sessions', async (request, reply) => {
    try {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      const parseCount = (value: string | undefined): number | undefined => {
        if (value === undefined || value === '') return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      const payload = await client.listSessions({
        limit: parseCount(limit),
        offset: parseCount(offset),
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
      const result = await client.deleteSession(sessionId);
      opts.images?.deleteSession(sessionId);
      return await reply.send(result);
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
