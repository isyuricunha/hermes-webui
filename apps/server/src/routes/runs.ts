import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
import { sendHermesError } from '../hermes/errors';
import type { MessageImageStore } from '../images';

type RunInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * Run lifecycle routes (PRD 17): durable run submission, status polling,
 * SSE event pass-through, stop, steer and approvals. The gateway owns runs;
 * the WebUI adds an Idempotency-Key so browser retries cannot double-submit.
 */
export async function runRoutes(
  app: FastifyInstance,
  opts: { client: HermesClient; images?: MessageImageStore },
): Promise<void> {
  const client = opts.client;
  // A message is plain text, or text plus images (vision parts). Images
  // travel as data URLs in the gateway's canonical image_url shape; other
  // files are not accepted by /v1/runs (text files are inlined client-side).
  app.post(
    '/api/runs',
    {
      bodyLimit: 48 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['input'],
          properties: {
            // One union type instead of anyOf: Fastify's Ajv coerces types
            // ("array" mode), and inside anyOf the string branch unwrapped a
            // one-element array (an image with no text) before the array
            // branch ever saw it. Length keywords only apply to their type.
            input: {
              type: ['string', 'array'],
              minLength: 1,
              minItems: 1,
              maxItems: 11,
              items: {
                anyOf: [
                  {
                    type: 'object',
                    required: ['type', 'text'],
                    properties: { type: { const: 'text' }, text: { type: 'string' } },
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    required: ['type', 'image_url'],
                    properties: {
                      type: { const: 'image_url' },
                      image_url: {
                        type: 'object',
                        required: ['url'],
                        properties: {
                          url: {
                            type: 'string',
                            pattern: '^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$',
                            maxLength: 16 * 1024 * 1024,
                          },
                        },
                        additionalProperties: false,
                      },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            session_id: { type: 'string' },
            model: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          input: string | RunInputPart[];
          session_id?: string;
          model?: string;
        };
        const images = Array.isArray(body.input) ? body.input.filter((part) => part.type === 'image_url') : [];
        if (images.length > 10) {
          return await reply.status(400).send({
            error: { code: 'TOO_MANY_IMAGES', message: 'Attach at most 10 images per message.' },
            requestId: request.id,
          });
        }
        const input = Array.isArray(body.input)
          ? [{ role: 'user' as const, content: body.input }]
          : body.input;
        const payload = await client.createRun({ ...body, input }, crypto.randomUUID());
        if (images.length > 0 && body.session_id !== undefined) {
          try {
            opts.images?.saveSend(body.session_id, images.map((part) => (part as { image_url: { url: string } }).image_url.url));
          } catch (error) {
            request.log.warn({ err: error }, 'could not keep sent images for history');
          }
        }
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
      unregisterStream?.();
      if (expiryTimer !== null) clearTimeout(expiryTimer);
    });
    let unregisterStream: (() => void) | null = null;
    let expiryTimer: NodeJS.Timeout | null = null;
    if (request.auth?.session !== undefined && request.auth.session !== null) {
      const session = request.auth.session;
      unregisterStream = app.registerSessionStream(session.id, () => abort.abort());
      // Spec 2.18: a stream never outlives its session's validity window.
      const expiresAt = Math.min(session.idle_expires_at, session.absolute_expires_at);
      expiryTimer = setTimeout(() => abort.abort(), Math.max(0, expiresAt - Date.now()));
      expiryTimer.unref?.();
    }
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
