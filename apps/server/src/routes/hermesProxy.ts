import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isDeliverableMediaPath } from '@hermes-webui/shared';
import type { HermesDashboardClient } from '../hermes/dashboard';
import { sendHermesError } from '../hermes/errors';

/**
 * Allowlisted pass-through to the Hermes dashboard API, mounted at
 * `/api/hx/*` -> dashboard `/api/*`.
 *
 * Only the rules below exist: anything else is a 404 here, never forwarded.
 * Path parameters are restricted to a safe identifier alphabet, only the
 * listed query keys are passed on, and JSON bodies are forwarded as-is to
 * the matching dashboard route (which validates them). Session auth and CSRF
 * come from the global auth policy like every other /api route.
 *
 * Deliberately absent: anything that returns provider secrets
 * (`/api/audio/voice-config`, `/api/env/reveal`), writes arbitrary files or
 * runs git/shell operations. File reads exist only for `MEDIA:` deliveries
 * and are narrowed by `isDeliverableMediaPath` (absolute path, media or
 * document extension, no credential folders) on top of the dashboard's own
 * sensitive-file guard.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProxyRule {
  method: Method;
  /** Dashboard path below /api, with `:param` segments. */
  path: string;
  /** Query keys forwarded to the dashboard. */
  query?: readonly string[];
  /** Stream the upstream body back (downloads) instead of JSON. */
  download?: boolean;
  /** Upstream timeout; synthesis/transcription can take a while. */
  timeoutMs?: number;
  /** Request body cap for large JSON payloads (base64 audio). */
  bodyLimit?: number;
  /** Extra check on the forwarded query; false answers 400 without calling Hermes. */
  guard?: (query: URLSearchParams) => boolean;
  /** Cache-Control for the response (default: no-store). */
  cacheControl?: string;
}

export const PROXY_RULES: readonly ProxyRule[] = [
  // Usage analytics
  { method: 'GET', path: 'analytics/usage', query: ['days'] },
  { method: 'GET', path: 'analytics/models', query: ['days'] },
  // Session store (search, stats, export)
  { method: 'GET', path: 'sessions/search', query: ['q', 'limit', 'source', 'sources', 'exclude_sources'] },
  { method: 'GET', path: 'sessions/stats' },
  { method: 'GET', path: 'sessions/:id/export', download: true },
  // Memory, curator
  { method: 'GET', path: 'memory' },
  { method: 'GET', path: 'curator' },
  { method: 'PUT', path: 'curator/paused' },
  // Skills and toolsets
  { method: 'GET', path: 'skills' },
  { method: 'GET', path: 'skills/content', query: ['name'] },
  { method: 'PUT', path: 'skills/content' },
  { method: 'POST', path: 'skills' },
  { method: 'PUT', path: 'skills/toggle' },
  { method: 'GET', path: 'tools/toolsets' },
  { method: 'PUT', path: 'tools/toolsets/:name' },
  // Profiles and SOUL
  { method: 'GET', path: 'profiles' },
  { method: 'GET', path: 'profiles/active' },
  { method: 'GET', path: 'profiles/:name/soul' },
  { method: 'PUT', path: 'profiles/:name/soul' },
  { method: 'PATCH', path: 'profiles/:name' },
  { method: 'PUT', path: 'profiles/:name/description' },
  // Cron: history, create, edit
  { method: 'GET', path: 'cron/jobs/:id/runs', query: ['limit'] },
  { method: 'GET', path: 'cron/delivery-targets' },
  { method: 'POST', path: 'cron/jobs' },
  { method: 'PUT', path: 'cron/jobs/:id' },
  // MCP servers: add, remove, enable, test
  { method: 'GET', path: 'mcp/servers' },
  { method: 'POST', path: 'mcp/servers' },
  { method: 'DELETE', path: 'mcp/servers/:name' },
  { method: 'PUT', path: 'mcp/servers/:name/enabled' },
  { method: 'POST', path: 'mcp/servers/:name/test', timeoutMs: 60_000 },
  // System
  { method: 'GET', path: 'status' },
  { method: 'GET', path: 'system/stats' },
  { method: 'GET', path: 'logs', query: ['file', 'lines', 'level', 'component', 'search'] },
  // Webhooks
  { method: 'GET', path: 'webhooks' },
  { method: 'PUT', path: 'webhooks/:name/enabled' },
  { method: 'POST', path: 'webhooks/enable', timeoutMs: 60_000 },
  { method: 'POST', path: 'webhooks' },
  { method: 'DELETE', path: 'webhooks/:name' },
  // Files the assistant delivered with MEDIA:/path (images, audio, documents)
  {
    method: 'GET',
    path: 'fs/download',
    query: ['path'],
    download: true,
    guard: (query) => isDeliverableMediaPath(query.get('path') ?? ''),
    cacheControl: 'private, max-age=600',
  },
  // Voice (relay mode: audio goes through Hermes, keys never reach the browser)
  { method: 'POST', path: 'audio/transcribe', timeoutMs: 180_000, bodyLimit: 32 * 1024 * 1024 },
  { method: 'POST', path: 'audio/speak', timeoutMs: 180_000 },
];

const SAFE_PARAM = /^[A-Za-z0-9._:@-]{1,200}$/;

function buildTarget(rule: ProxyRule, request: FastifyRequest): { url: string; query: URLSearchParams } | null {
  const params = (request.params ?? {}) as Record<string, string>;
  const segments: string[] = [];
  for (const segment of rule.path.split('/')) {
    if (segment.startsWith(':')) {
      const value = params[segment.slice(1)];
      // Dot-only values ("." / "..") would walk to another dashboard route.
      if (value === undefined || !SAFE_PARAM.test(value) || /^\.+$/.test(value)) {
        return null;
      }
      segments.push(encodeURIComponent(value));
    } else {
      segments.push(segment);
    }
  }
  const query = new URLSearchParams();
  const incoming = (request.query ?? {}) as Record<string, unknown>;
  for (const key of rule.query ?? []) {
    const value = incoming[key];
    if (typeof value === 'string' && value.length <= 1024) {
      query.set(key, value);
    }
  }
  const qs = query.toString();
  return { url: `/api/${segments.join('/')}${qs === '' ? '' : `?${qs}`}`, query };
}

async function forward(
  dashboard: HermesDashboardClient,
  rule: ProxyRule,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const built = buildTarget(rule, request);
  if (built === null || (rule.guard !== undefined && !rule.guard(built.query))) {
    return reply.status(400).send({
      error: { code: 'INVALID_PARAMETER', message: 'Invalid or disallowed parameter.' },
      requestId: request.id,
    });
  }
  const target = built.url;
  try {
    if (rule.download === true) {
      const upstream = await dashboard.download(target, rule.timeoutMs);
      reply.header('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      const disposition = upstream.headers.get('content-disposition');
      if (disposition !== null) {
        reply.header('content-disposition', disposition);
      }
      reply.header('cache-control', rule.cacheControl ?? 'no-store');
      // Downloaded files are untrusted content: never let one run as a page here.
      reply.header('content-security-policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
      if (upstream.body === null) {
        return await reply.send('');
      }
      return await reply.send(Readable.fromWeb(upstream.body as NodeWebReadableStream));
    }
    const body = rule.method === 'GET' || rule.method === 'DELETE' ? undefined : (request.body ?? {});
    const payload = await dashboard.call(rule.method, target, body, rule.timeoutMs);
    return await reply.header('cache-control', 'no-store').send(payload ?? { ok: true });
  } catch (error) {
    return sendHermesError(reply, request.id, error);
  }
}

export async function hermesProxyRoutes(
  app: FastifyInstance,
  opts: { dashboard: HermesDashboardClient },
): Promise<void> {
  for (const rule of PROXY_RULES) {
    app.route({
      method: rule.method,
      url: `/api/hx/${rule.path}`,
      ...(rule.bodyLimit !== undefined ? { bodyLimit: rule.bodyLimit } : {}),
      handler: (request, reply) => forward(opts.dashboard, rule, request, reply),
    });
  }
}
