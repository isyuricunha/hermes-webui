import { requestJson } from '../../lib/api';

/**
 * Composer attachments, handled like Hermes' messaging gateway does:
 * - images are downscaled client-side and sent as image_url data URLs;
 * - small text files are inlined into the message as fenced blocks;
 * - anything else (audio, video, PDF, documents, archives...) is uploaded to
 *   the WebUI server, which saves it where Hermes can read it, and the
 *   message carries the same note the gateway writes ("The user sent ...
 *   It is saved at: <path>"), so the agent transcribes or reads it itself.
 */

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: 'audio' | 'video' | 'image' | 'text' | 'document';
  path: string;
  url: string;
}

export interface PendingAttachment {
  id: string;
  kind: 'image' | 'text' | 'file';
  name: string;
  size: number;
  /** Image data URL (kind "image"). */
  dataUrl?: string;
  /** File contents (kind "text"). */
  text?: string;
  /** Saved copy Hermes reads (kind "file"). */
  upload?: UploadedFile;
}

export type RunInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export const MAX_ATTACHMENTS = 10;
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'csv', 'tsv',
  'log', 'xml', 'html', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'lua', 'r',
  'dockerfile', 'service', 'timer', 'nix', 'tf', 'hcl', 'vue', 'svelte', 'gitignore',
]);

export function classifyFile(file: { name: string; type: string; size: number }): 'image' | 'text' | null {
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return 'image';
  if (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/xml') {
    return 'text';
  }
  const lower = file.name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
  return TEXT_EXTENSIONS.has(ext) ? 'text' : null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Downscales large photos so a message stays well under the upload cap. */
async function prepareImage(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return original;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const resized = canvas.toDataURL(type, 0.88);
    return resized.length < original.length ? resized : original;
  } catch {
    return original;
  }
}

/** Uploads a file to the WebUI server (saved where Hermes can read it). */
export function uploadFile(file: File): Promise<UploadedFile> {
  return requestJson<UploadedFile>(`/api/uploads?name=${encodeURIComponent(file.name || 'file')}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': file.type || 'application/octet-stream' },
  });
}

export async function readAttachment(file: File): Promise<PendingAttachment> {
  const kind = classifyFile(file);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (kind === 'image' && file.size <= MAX_IMAGE_BYTES) {
    return { id, kind, name: file.name || 'pasted image', size: file.size, dataUrl: await prepareImage(file) };
  }
  if (kind === 'text' && file.size <= MAX_TEXT_BYTES) {
    return { id, kind, name: file.name, size: file.size, text: await file.text() };
  }
  // Everything else, and text or images too big to inline: save it for Hermes.
  const upload = await uploadFile(file);
  return { id, kind: 'file', name: upload.name, size: upload.size, upload };
}

/** The note Hermes' gateway writes for an inbound file (gateway/run.py, run_inbound.py). */
export function fileNote(upload: UploadedFile): string {
  const where = `It is saved at: ${upload.path}.`;
  switch (upload.kind) {
    case 'audio':
      return `[The user sent an audio file attachment: '${upload.name}'. ${where} Its content is not inlined here. If the user's request involves what the audio contains, transcribe or process it yourself — for example by passing the path to a transcription or media tool — instead of asking the user to describe it. Only ask what to do with it if their intent is genuinely unclear.]`;
    case 'video':
      return `[The user sent a video attachment: '${upload.name}'. ${where} Its content is not inlined here. If the user's request involves what the video contains, inspect or process it yourself — for example by passing the path to a video analysis or media tool — instead of asking the user to describe it. Only ask what to do with it if their intent is genuinely unclear.]`;
    case 'text':
      return `[The user sent a text document: '${upload.name}'. ${where} Its content is not inlined here. Read the cached file yourself before answering when the user's request involves its contents.]`;
    case 'image':
      return `[The user sent an image: '${upload.name}'. ${where} It is too large to attach inline; open it from that path with a vision or image tool when the request involves it.]`;
    default:
      return `[The user sent a document: '${upload.name}'. ${where} Its text is not inlined here (it's a binary format such as PDF or DOCX). To read it, extract the document's text yourself — for example with the terminal tool or the ocr-and-documents skill — before answering, instead of asking the user to paste the contents.]`;
  }
}

function fenceFor(text: string): string {
  let fence = '```';
  while (text.includes(fence)) fence += '`';
  return fence;
}

/** Message text with inlined text files, plus image parts when present. */
export function buildRunInput(text: string, attachments: PendingAttachment[]): string | RunInputPart[] {
  const files = attachments.filter((item) => item.kind === 'text' && item.text !== undefined);
  const images = attachments.filter((item) => item.kind === 'image' && item.dataUrl !== undefined);
  const uploads = attachments.flatMap((item) => (item.kind === 'file' && item.upload !== undefined ? [item.upload] : []));
  // Notes go first, as the gateway prepends them.
  let body = uploads.length === 0 ? text : [...uploads.map(fileNote), text].filter((part) => part !== '').join('\n\n');
  for (const file of files) {
    const content = file.text ?? '';
    const fence = fenceFor(content);
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : '';
    body += `${body === '' ? '' : '\n\n'}Attached file \`${file.name}\`:\n${fence}${ext}\n${content}\n${fence}`;
  }
  if (images.length === 0) return body;
  const parts: RunInputPart[] = [];
  if (body.trim() !== '') parts.push({ type: 'text', text: body });
  for (const image of images) parts.push({ type: 'image_url', image_url: { url: image.dataUrl as string } });
  return parts;
}
