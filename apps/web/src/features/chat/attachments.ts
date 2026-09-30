/**
 * Composer attachments. /v1/runs accepts text plus image parts only, so:
 * - images are downscaled client-side and sent as image_url data URLs;
 * - text-like files are inlined into the message as fenced blocks;
 * - anything else is refused with a clear reason.
 */

export interface PendingAttachment {
  id: string;
  kind: 'image' | 'text';
  name: string;
  size: number;
  /** Image data URL (kind "image"). */
  dataUrl?: string;
  /** File contents (kind "text"). */
  text?: string;
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

export async function readAttachment(file: File): Promise<PendingAttachment> {
  const kind = classifyFile(file);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (kind === 'image') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
    return { id, kind, name: file.name || 'pasted image', size: file.size, dataUrl: await prepareImage(file) };
  }
  if (kind === 'text') {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name} is larger than 256 KB; ask Hermes to read it from disk instead.`);
    return { id, kind, name: file.name, size: file.size, text: await file.text() };
  }
  throw new Error(`${file.name}: only images and text files can be attached here.`);
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
  let body = text;
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
