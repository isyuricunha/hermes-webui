/**
 * Hermes `MEDIA:/absolute/path` delivery tags.
 *
 * On messaging platforms the gateway turns these tags into native
 * attachments; the WebUI renders them inline instead and fetches the file
 * through the server's allowlisted proxy. The server enforces
 * `isDeliverableMediaPath` (absolute path, known extension, no credential
 * directories); the browser uses the same rules to decide what to render.
 */

export type MediaKind = 'image' | 'audio' | 'video' | 'file';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'];
const AUDIO = ['mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav', 'flac', 'aac'];
const VIDEO = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];
const FILE = [
  'pdf', 'txt', 'md', 'csv', 'tsv', 'log', 'html', 'htm', 'epub', 'rtf',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'tar', 'gz', 'tgz', '7z',
];

const KIND_BY_EXTENSION = new Map<string, MediaKind>([
  ...IMAGE.map((ext) => [ext, 'image'] as const),
  ...AUDIO.map((ext) => [ext, 'audio'] as const),
  ...VIDEO.map((ext) => [ext, 'video'] as const),
  ...FILE.map((ext) => [ext, 'file'] as const),
]);

/** Path segments that hold credentials anywhere they appear. */
const DENIED_SEGMENTS = new Set([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', 'keyrings', 'gcloud',
  'mcp-tokens', 'pairing',
]);
const DENIED_ROOTS = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/', '/run/', '/var/lib/', '/var/run/'];

export function mediaFileName(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name === '' ? path : name;
}

export function mediaKindOf(path: string): MediaKind | null {
  const name = mediaFileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return KIND_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** Whether the WebUI may fetch `path` for display or download. */
export function isDeliverableMediaPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024 || /[\0\r\n]/.test(path)) return false;
  if (!path.startsWith('/') && !path.startsWith('~/')) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return false;
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment.toLowerCase()))) return false;
  if (DENIED_ROOTS.some((root) => path.startsWith(root))) return false;
  return mediaKindOf(path) !== null;
}

export interface MediaTag {
  /** Offsets of the whole tag (including wrapping quotes/emphasis) in the text. */
  start: number;
  end: number;
  path: string;
}

/** Offsets of fenced code blocks and inline code spans, where tags are only examples. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$)/gm;
  for (const match of text.matchAll(fence)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  const inline = /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)|(`+)(?!`)\2(?!`)/g;
  for (const match of text.matchAll(inline)) {
    const start = match.index;
    if (!ranges.some(([from, to]) => start >= from && start < to)) {
      ranges.push([start, start + match[0].length]);
    }
  }
  return ranges;
}

const TAG = /[*_]{0,3}["'`]?MEDIA:[ \t]*(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|(?:~\/|\/)[^\s`"'<>]+)["'`]?[*_]{0,3}/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}*_]+$/;

/**
 * `MEDIA:` tags outside code, in order. Mirrors the gateway's extraction:
 * absolute or `~/` paths, bare or wrapped in quotes/backticks; tags inside
 * code blocks or inline code are examples, not deliveries.
 */
export function findMediaTags(text: string): MediaTag[] {
  if (!text.includes('MEDIA:')) return [];
  const code = codeRanges(text);
  const tags: MediaTag[] = [];
  for (const match of text.matchAll(TAG)) {
    const tagAt = match.index + match[0].indexOf('MEDIA:');
    if (code.some(([from, to]) => tagAt >= from && tagAt < to)) continue;
    const group = match[1] ?? '';
    const pathStart = text.indexOf(group, tagAt);
    const quoted = /^[`"']/.test(group);
    // Punctuation after a bare path belongs to the sentence: keep it.
    const trailing = quoted ? '' : (TRAILING_PUNCTUATION.exec(group)?.[0] ?? '');
    const path = quoted ? group.slice(1, -1).trim() : group.slice(0, group.length - trailing.length);
    const pathEnd = pathStart + (quoted ? group.length : path.length);
    // Wrapping emphasis/quotes (**MEDIA:/x.png**) go with the tag only when closed.
    const lead = text.slice(match.index, tagAt);
    const mirror = [...lead].reverse().join('');
    const closed = text.startsWith(mirror, pathEnd);
    if (path.startsWith('/') || path.startsWith('~/')) {
      tags.push({ start: closed ? match.index : tagAt, end: closed ? pathEnd + mirror.length : pathEnd, path });
    }
  }
  return tags;
}

/** Custom URL scheme the chat renderer maps to an inline media embed. */
export const MEDIA_URL_SCHEME = 'hermes-media:';

/**
 * Rewrites `MEDIA:` tags into markdown images with the `hermes-media:`
 * scheme so they render in place, and drops the delivery-only directives
 * (`[[audio_as_voice]]`, `[[as_document]]`).
 */
export function rewriteMediaTags(text: string): string {
  const tags = findMediaTags(text);
  let out = text;
  for (const tag of [...tags].reverse()) {
    const target = encodeURIComponent(tag.path).replace(/\(/g, '%28').replace(/\)/g, '%29');
    // Embeds render as blocks: a sentence-ending "." left on its own line is noise.
    const dangling = /^[.,;:!?]+(?=[ \t]*(?:\n|$))/.exec(out.slice(tag.end))?.[0] ?? '';
    out = `${out.slice(0, tag.start)}![media](${MEDIA_URL_SCHEME}${target})${out.slice(tag.end + dangling.length)}`;
  }
  if (tags.length > 0) {
    out = out.replace(/\[\[(?:audio_as_voice|as_document)\]\]/g, '');
  }
  return out;
}

/** Message text without its `MEDIA:` tags (for copying and reading aloud). */
export function stripMediaTags(text: string): string {
  const tags = findMediaTags(text);
  let out = text;
  for (const tag of [...tags].reverse()) {
    out = `${out.slice(0, tag.start)}${out.slice(tag.end)}`;
  }
  return tags.length > 0 ? out.replace(/\[\[(?:audio_as_voice|as_document)\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim() : out;
}
