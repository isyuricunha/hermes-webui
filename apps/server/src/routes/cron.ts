import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../hermes/client';
import { sendHermesError } from '../hermes/errors';

/**
 * Cron / automations routes (PRD 26, MVP admin scope). Proxies the gateway's
 * /api/jobs CRUD + pause/resume/run. Schedule format and prompt validation
 * are Hermes-owned; the WebUI renders and forwards.
 */
export async function cronRoutes(
  app: FastifyInstance,
  opts: { client: HermesClient },
): Promise<void> {
  const client = opts.client;

  app.get('/api/cron/jobs', async (request, reply) => {
    try {
      return await reply.send(await client.listJobs());
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/cron/jobs', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      return await reply.send(await client.createJob(body));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.get('/api/cron/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await reply.send(await client.getJob(jobId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.patch('/api/cron/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      const body = request.body as Record<string, unknown>;
      return await reply.send(await client.updateJob(jobId, body));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.delete('/api/cron/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await reply.send(await client.deleteJob(jobId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/cron/jobs/:jobId/pause', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await reply.send(await client.pauseJob(jobId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/cron/jobs/:jobId/resume', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await reply.send(await client.resumeJob(jobId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });

  app.post('/api/cron/jobs/:jobId/run', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await reply.send(await client.runJob(jobId));
    } catch (error) {
      return sendHermesError(reply, request.id, error);
    }
  });
}
