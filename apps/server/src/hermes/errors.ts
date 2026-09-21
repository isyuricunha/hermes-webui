import type { FastifyReply } from 'fastify';
import { HermesHttpError } from './client';

export interface MappedError {
  status: number;
  body: {
    error: { code: string; message: string; details?: unknown };
    requestId: string;
  };
}

/**
 * Maps gateway failures onto the WebUI error envelope (PRD 41).
 *
 * - Gateway 401/403 means the WEBUI is misconfigured (its key is wrong), not
 *   the browser client: surface as 502 HERMES_AUTH_FAILED with a human
 *   message.
 * - Unreachable gateway: 503 HERMES_UNREACHABLE (drives the offline/reconnect
 *   UX states, PRD 40).
 * - Everything else passes the gateway status through with its message, so
 *   the UI can show the real cause instead of a generic 500.
 */
export function mapHermesError(reply: FastifyReply, requestId: string, error: unknown): MappedError {
  if (error instanceof HermesHttpError) {
    if (error.code === 'HERMES_UNREACHABLE') {
      return {
        status: 503,
        body: {
          error: { code: 'HERMES_UNREACHABLE', message: error.message },
          requestId,
        },
      };
    }
    if (error.status === 401 || error.status === 403) {
      if (error.code.startsWith('HERMES_DASHBOARD')) {
        return {
          status: 502,
          body: {
            error: {
              code: 'HERMES_DASHBOARD_AUTH',
              message:
                'The WebUI could not authenticate to the Hermes dashboard API. Check HERMES_DASHBOARD_SESSION_TOKEN in the WebUI server configuration.',
              details: error.body,
            },
            requestId,
          },
        };
      }
      return {
        status: 502,
        body: {
          error: {
            code: 'HERMES_AUTH_FAILED',
            message:
              'The WebUI could not authenticate to the Hermes gateway. Check HERMES_API_KEY in the WebUI server configuration.',
            details: error.body,
          },
          requestId,
        },
      };
    }
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, details: error.body },
        requestId,
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error talking to Hermes.',
      },
      requestId,
    },
  };
}

/** Route-helper: send a mapped error and return the reply for `return` use. */
export function sendHermesError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
): FastifyReply {
  const mapped = mapHermesError(reply, requestId, error);
  return reply.status(mapped.status).send(mapped.body);
}
