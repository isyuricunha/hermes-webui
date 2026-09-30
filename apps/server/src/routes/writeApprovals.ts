import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  APPROVAL_SUBSYSTEMS,
  PENDING_ID,
  WriteApprovalError,
  type ApprovalSubsystem,
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
}
