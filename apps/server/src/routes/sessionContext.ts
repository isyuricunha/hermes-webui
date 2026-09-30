import type { FastifyInstance } from 'fastify';
import type { HermesDashboardClient } from '../hermes/dashboard';
import { HermesHttpError } from '../hermes/client';

/**
 * GET /api/sessions/:sessionId/context — how full the conversation's context
 * window is. Hermes records the prompt size of the last model call
 * (`model_config._usage_anchor.prompt_tokens` on the dashboard session row);
 * the window comes from the model info when the conversation runs the default
 * model. Only numbers leave the server (the row also holds the system prompt).
 */

export interface SessionContextInfo {
  model: string | null;
  used: number | null;
  contextLength: number | null;
  messages: number | null;
  apiCalls: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  cost: number | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Prompt size of the conversation's last model call, from `model_config`. */
function lastPromptTokens(raw: unknown): number | null {
  try {
    const config = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown> | null);
    const anchor = config?._usage_anchor as Record<string, unknown> | undefined;
    return num(anchor?.prompt_tokens);
  } catch {
    return null;
  }
}

export function contextFromSessionRow(row: Record<string, unknown>, info: Record<string, unknown> | null): SessionContextInfo {
  const used = lastPromptTokens(row.model_config);
  const model = typeof row.model === 'string' && row.model !== '' ? row.model : null;
  const sameModel = info !== null && (model === null || info.model === model);
  return {
    model: model ?? (typeof info?.model === 'string' ? info.model : null),
    used,
    contextLength: sameModel ? num(info?.effective_context_length) : null,
    messages: num(row.message_count),
    apiCalls: num(row.api_call_count),
    input: num(row.input_tokens),
    output: num(row.output_tokens),
    cacheRead: num(row.cache_read_tokens),
    cacheWrite: num(row.cache_write_tokens),
    reasoning: num(row.reasoning_tokens),
    cost: num(row.actual_cost_usd) ?? num(row.estimated_cost_usd),
  };
}

export async function sessionContextRoutes(app: FastifyInstance, opts: { dashboard: HermesDashboardClient }): Promise<void> {
  app.get(
    '/api/sessions/:sessionId/context',
    { schema: { params: { type: 'object', properties: { sessionId: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' } } } } },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      try {
        const [row, info] = await Promise.all([
          opts.dashboard.call<Record<string, unknown>>('GET', `/api/sessions/${encodeURIComponent(sessionId)}`),
          opts.dashboard.call<Record<string, unknown>>('GET', '/api/model/info').catch(() => null),
        ]);
        return await reply.header('cache-control', 'no-store').send(contextFromSessionRow(row, info));
      } catch (error) {
        if (error instanceof HermesHttpError) {
          return reply.status(error.status === 404 ? 404 : 502).send({
            error: { code: error.code, message: error.message },
            requestId: request.id,
          });
        }
        throw error;
      }
    },
  );
}
