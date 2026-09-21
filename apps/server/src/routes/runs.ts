import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
import { sendHermesError } from '../hermes/errors';

/**
 * Run lifecycle routes (PRD 17): durable run submission, status polling,
 * SSE event pass-through, stop, steer and approvals. The gateway owns runs;
 * the WebUI adds an Idempotency-Key so browser retries cannot double-submit.
 */
export async function runRoutes(
  app: FastifyInstance,
  opts: { client: HermesClient },
): Promise<void> {
  const client = opts.client;
  app.post(
    '/api/runs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['input'],
          properties: {
            input: { type: 'string', minLength: 1 },
            session_id: { type: 'string' },
            model: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as { input: string; session_id?: string; model?: string };
        const payload = await client.createRun(body, crypto.randomUUID());
        return await reply.send(payload);
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.get('/api/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await reply.send(await client.getRun(runId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const abort = new AbortController();
    request.raw.on('close', () => {
      abort.abort();
    });
    try {
      const upstream = await client.openRunEvents(runId, abort.signal);
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        return await reply.status(502).send({
          error: {
            code: 'HERMES_STREAM_FAILED',
            message: `Hermes gateway refused the event stream (HTTP ${upstream.status}).`,
            details: detail || undefined,
          },
          requestId: request.id,
        });
      }
      reply.header('content-type', 'text/event-stream');
      reply.header('cache-control', 'no-cache');
      reply.header('connection', 'keep-alive');
      return await reply.send(Readable.fromWeb(upstream.body as NodeWebReadableStream));
    } catch (error) {
      if (abort.signal.aborted) {
        // Browser went away; nothing to answer.
        return reply;
      }
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/runs/:runId/stop', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await reply.send(await client.stopRun(runId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post(
    '/api/runs/:runId/steer',
    {
      schema: {
        body: {
          type: 'object',
          required: ['input'],
          properties: { input: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { runId } = request.params as { runId: string };
      try {
        const { input } = request.body as { input: string };
        return await reply.send(await client.steerRun(runId, input));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );

  app.post(
    '/api/runs/:runId/approval',
    {
      schema: {
        body: {
          type: 'object',
          required: ['choice'],
          properties: {
            choice: { enum: ['once', 'session', 'always', 'deny'] },
            request_id: { type: 'string' },
            all: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { runId } = request.params as { runId: string };
      try {
        const body = request.body as {
          choice: 'once' | 'session' | 'always' | 'deny';
          request_id?: string;
          all?: boolean;
        };
        return await reply.send(await client.resolveApproval(runId, body));
      } catch (error) {
        return sendHermesError(reply, request.id, error);
      }
    },
  );
}
