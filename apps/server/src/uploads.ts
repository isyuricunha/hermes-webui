import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Files attached in the chat. Hermes' messaging gateway saves an inbound
 * file and tells the agent where it is; the WebUI does the same: the file is
 * written to `<uploadDir>/<id>/<name>` and the message carries a note with
 * that absolute path (see apps/web attachments.ts).
 */

export type UploadKind = 'audio' | 'video' | 'image' | 'text' | 'document';

export interface SavedUpload {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: UploadKind;
  /** Absolute path Hermes reads. */
  path: string;
}

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm', amr: 'audio/amr',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
};

/** Keeps a readable name: no path parts, no control or shell-special characters. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._\- ()[\]]/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'file' : cleaned;
}

export function mimeFor(name: string, declared: string | undefined): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const byExt = MIME_BY_EXT[ext];
  if (declared !== undefined && /^[\w.+-]+\/[\w.+-]+$/.test(declared) && declared !== 'application/octet-stream') return declared;
  return byExt ?? 'application/octet-stream';
}

export function kindOf(mime: string): UploadKind {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'document';
}

export class UploadStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  save(data: Buffer, rawName: string, declaredMime?: string): SavedUpload {
    const name = safeFileName(rawName);
    const id = randomUUID();
    const dir = path.join(this.root, id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    writeFileSync(file, data, { mode: 0o600 });
    const mime = mimeFor(name, declaredMime);
    return { id, name, size: data.length, mime, kind: kindOf(mime), path: file };
  }

  /** The stored file for an id, or undefined. */
  find(id: string): { path: string; name: string; size: number; mime: string } | undefined {
    if (!UPLOAD_ID.test(id)) return undefined;
    const dir = path.join(this.root, id);
    if (!existsSync(dir)) return undefined;
    const [name] = readdirSync(dir);
    if (name === undefined) return undefined;
    const file = path.join(dir, name);
    const stat = statSync(file);
    if (!stat.isFile()) return undefined;
    return { path: file, name, size: stat.size, mime: mimeFor(name, undefined) };
  }

  stream(file: string) {
    return createReadStream(file);
  }
}
