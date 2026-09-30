import type { FastifyInstance } from 'fastify';
import type { UploadStore } from '../uploads';

/**
 * POST /api/uploads?name=<file name>  (raw bytes, any content type)
 *   -> { id, name, size, mime, kind, path, url }
 * GET  /api/uploads/:id  -> the file (download, sandboxed)
 * Session auth and CSRF come from the global /api policy.
 */
export async function uploadRoutes(app: FastifyInstance, opts: { store: UploadStore; maxBytes: number }): Promise<void> {
  // Raw bodies for this plugin only (encapsulated): any type, kept as a Buffer.
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: opts.maxBytes }, (_request, body, done) => done(null, body));

  app.post(
    '/api/uploads',
    {
      bodyLimit: opts.maxBytes,
      schema: {
        querystring: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 255 } },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.status(400).send({ error: { code: 'EMPTY_UPLOAD', message: 'The file is empty.' }, requestId: request.id });
      }
      const { name } = request.query as { name: string };
      const declared = String(request.headers['content-type'] ?? '').split(';')[0]?.trim();
      const saved = opts.store.save(body, name, declared);
      return reply.status(201).send({ ...saved, url: `/api/uploads/${saved.id}` });
    },
  );

  app.get('/api/uploads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = opts.store.find(id);
    if (file === undefined) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File not found.' }, requestId: request.id });
    }
    const inline = /^(audio|video|image\/(png|jpeg|gif|webp))/.test(file.mime);
    return reply
      .header('content-type', file.mime)
      .header('content-length', String(file.size))
      .header('cache-control', 'private, max-age=86400')
      .header('content-security-policy', "sandbox; default-src 'none'; media-src 'self'; frame-ancestors 'none'")
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .send(opts.store.stream(file.path));
  });
}
