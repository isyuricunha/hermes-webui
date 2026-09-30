import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  APPROVAL_SUBSYSTEMS,
  PENDING_ID,
  SKILL_NAME,
  WriteApprovalError,
  type ApprovalSubsystem,
  type MemoryTarget,
  type WriteApprovalBridge,
} from '../hermes/writeApprovals';

/**
 * Pending memory/skill writes (Hermes' `/memory` and `/skills` approval
 * queue). Session auth and CSRF come from the global /api policy.
 */
export async function writeApprovalRoutes(
  app: FastifyInstance,
  opts: { bridge: WriteApprovalBridge },
): Promise<void> {
  const fail = (reply: FastifyReply, requestId: string, error: unknown) => {
    if (error instanceof WriteApprovalError) {
      return reply.status(error.code === 'WRITE_APPROVALS_UNAVAILABLE' ? 503 : 502).send({
        error: { code: error.code, message: error.message },
        requestId,
      });
    }
    throw error;
  };

  const subsystemParam = {
    type: 'object',
    required: ['subsystem'],
    properties: { subsystem: { type: 'string', enum: [...APPROVAL_SUBSYSTEMS] } },
  } as const;

  app.get('/api/write-approvals/:subsystem', { schema: { params: subsystemParam } }, async (request, reply) => {
    const { subsystem } = request.params as { subsystem: ApprovalSubsystem };
    try {
      return await reply.header('cache-control', 'no-store').send(await opts.bridge.list(subsystem));
    } catch (error) {
      return fail(reply, request.id, error);
    }
  });

  app.post(
    '/api/write-approvals/:subsystem/:id/:action',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subsystem', 'id', 'action'],
          properties: {
            subsystem: { type: 'string', enum: [...APPROVAL_SUBSYSTEMS] },
            id: { type: 'string', pattern: PENDING_ID.source },
            action: { type: 'string', enum: ['approve', 'reject'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { subsystem, id, action } = request.params as {
        subsystem: ApprovalSubsystem;
        id: string;
        action: 'approve' | 'reject';
      };
      try {
        const result = await opts.bridge.resolve(subsystem, action, id);
        request.log.info({ subsystem, action, id, ok: result.ok }, 'write approval resolved');
        return await reply.send(result);
      } catch (error) {
        return fail(reply, request.id, error);
      }
    },
  );

  // MEMORY.md (target "memory") and USER.md (target "user") entries.
  const targetParam = {
    type: 'object',
    required: ['target'],
    properties: { target: { type: 'string', enum: ['memory', 'user'] } },
  } as const;

  app.get('/api/memory-files/:target', { schema: { params: targetParam } }, async (request, reply) => {
    const { target } = request.params as { target: MemoryTarget };
    try {
      return await reply.header('cache-control', 'no-store').send(await opts.bridge.memoryEntries(target));
    } catch (error) {
      return fail(reply, request.id, error);
    }
  });

  app.post(
    '/api/memory-files/:target',
    {
      schema: {
        params: targetParam,
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['add', 'replace', 'remove'] },
            entry: { type: 'string', minLength: 1, maxLength: 20_000 },
            content: { type: 'string', minLength: 1, maxLength: 20_000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { target } = request.params as { target: MemoryTarget };
      const body = request.body as { action: 'add' | 'replace' | 'remove'; entry?: string; content?: string };
      const missing =
        (body.action !== 'remove' && body.content === undefined) || (body.action !== 'add' && body.entry === undefined);
      if (missing) {
        return await reply.status(400).send({
          error: { code: 'INVALID_BODY', message: 'add needs content; replace needs entry and content; remove needs entry.' },
          requestId: request.id,
        });
      }
      try {
        const edit =
          body.action === 'add'
            ? { action: 'add' as const, content: body.content as string }
            : body.action === 'remove'
              ? { action: 'remove' as const, entry: body.entry as string }
              : { action: 'replace' as const, entry: body.entry as string, content: body.content as string };
        const result = await opts.bridge.memoryEdit(target, edit);
        request.log.info({ target, action: body.action, ok: result.ok }, 'memory file edited');
        return await reply.status(result.ok ? 200 : 422).send(
          result.ok ? result : { error: { code: 'MEMORY_EDIT_REFUSED', message: result.message }, requestId: request.id },
        );
      } catch (error) {
        return fail(reply, request.id, error);
      }
    },
  );

  app.delete(
    '/api/skills/:name',
    { schema: { params: { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: SKILL_NAME.source } } } } },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      try {
        const result = await opts.bridge.deleteSkill(name);
        request.log.info({ skill: name, ok: result.ok }, 'skill delete');
        return await reply.status(result.ok ? 200 : 422).send(
          result.ok ? result : { error: { code: 'SKILL_DELETE_REFUSED', message: result.message }, requestId: request.id },
        );
      } catch (error) {
        return fail(reply, request.id, error);
      }
    },
  );
}
