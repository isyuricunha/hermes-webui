import type { MessageRow } from '../../lib/api';
import type { MessageAttachment, TranscriptItem } from './transcript';

/**
 * Converts persisted Hermes messages into transcript items (pure, tested).
 * Tool result rows carry no name, so it is taken from the assistant row
 * that issued the call (by tool_call_id, else in call order). Multimodal
 * user content (text + image parts) becomes text plus image attachments.
 */

/** Tool names recorded on assistant rows, keyed by call id (OpenAI shape). */
export function toolCallNames(toolCalls: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.flatMap((call: unknown) => {
    if (typeof call !== 'object' || call === null) return [];
    const record = call as { id?: unknown; name?: unknown; function?: { name?: unknown } };
    const name = record.function?.name ?? record.name;
    return typeof name === 'string' && name !== ''
      ? [{ id: typeof record.id === 'string' ? record.id : null, name }]
      : [];
  });
}

/** Splits string-or-parts content into display text and image attachments. */
export function splitContent(content: unknown): { text: string; attachments: MessageAttachment[] } {
  let parts: unknown = content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed.startsWith('[{')) return { text: content, attachments: [] };
    try {
      parts = JSON.parse(trimmed);
    } catch {
      return { text: content, attachments: [] };
    }
  }
  if (!Array.isArray(parts)) {
    return { text: typeof content === 'string' ? content : '', attachments: [] };
  }
  const texts: string[] = [];
  const attachments: MessageAttachment[] = [];
  for (const part of parts as unknown[]) {
    if (typeof part !== 'object' || part === null) continue;
    const record = part as { type?: unknown; text?: unknown; image_url?: unknown };
    const type = String(record.type ?? '');
    if ((type === 'text' || type === 'input_text') && typeof record.text === 'string') {
      texts.push(record.text);
    } else if (type === 'image_url' || type === 'input_image') {
      const ref = record.image_url;
      const url = typeof ref === 'string' ? ref : (ref as { url?: unknown } | null)?.url;
      attachments.push({
        kind: 'image',
        name: `image ${attachments.length + 1}`,
        ...(typeof url === 'string' ? { url } : {}),
      });
    }
  }
  return { text: texts.join('\n'), attachments };
}

/** An image the WebUI kept for a message it sent (GET /api/sessions/:id/images). */
export interface StoredImage {
  id: number;
  sent_at: number;
  position: number;
  mime: string;
}

const SCREENSHOT_LINE = /^\[screenshot\]$/;
/** Context some Hermes plugins append to the user turn (e.g. live-time). */
const INJECTED_MARKER = /^\[(?:LIVE-TIME|CONTEXT|SYSTEM CONTEXT)\]/m;

/**
 * Hermes persists image parts as a "[screenshot]" line. Put back the images
 * this WebUI sent: the send closest in time to the message (within 10 min),
 * each send used once.
 */
function restoreImages(
  text: string,
  timestamp: number | undefined,
  groups: Map<number, StoredImage[]>,
): { text: string; attachments: MessageAttachment[] } {
  const lines = text.split('\n');
  const count = lines.filter((line) => SCREENSHOT_LINE.test(line.trim())).length;
  if (count === 0) return { text, attachments: [] };
  let best: number | undefined;
  if (timestamp !== undefined) {
    for (const sentAt of groups.keys()) {
      const distance = Math.abs(sentAt - timestamp * 1000);
      if (distance <= 10 * 60_000 && (best === undefined || distance < Math.abs(best - timestamp * 1000))) best = sentAt;
    }
  }
  const images = best === undefined ? [] : (groups.get(best) ?? []);
  if (best !== undefined) groups.delete(best);
  const attachments: MessageAttachment[] = Array.from({ length: Math.max(count, images.length) }, (_, index) => {
    const image = images[index];
    return image !== undefined
      ? { kind: 'image' as const, name: `image ${index + 1}`, url: `/api/images/${image.id}` }
      : { kind: 'image' as const, name: 'image (not kept)' };
  });
  return {
    text: lines.filter((line) => !SCREENSHOT_LINE.test(line.trim())).join('\n').trim(),
    attachments,
  };
}

/** Hermes wraps a steer (message sent mid-run) in this marker pair. */
const STEER_BLOCK = /\[OUT-OF-BAND USER MESSAGE[^\]\n]*\]\s*([\s\S]*?)\s*\[\/OUT-OF-BAND USER MESSAGE\]/g;

/** Pulls steer messages out of persisted text (user rows, or appended to a tool result). */
export function extractSteers(text: string): { text: string; steers: string[] } {
  const steers: string[] = [];
  const rest = text.replace(STEER_BLOCK, (_match, body: string) => {
    if (body.trim() !== '') steers.push(body.trim());
    return '';
  });
  return steers.length === 0 ? { text, steers } : { text: rest.trim(), steers };
}

const FILE_NOTE =
  /\[The user sent (an audio file attachment|a video attachment|a text document|a document|an image|a voice message): '([^'\n]*)'\. It is saved at: (.+?)\.(?= |\])[^\]]*\]\s*/g;
const UPLOAD_PATH = /[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/][^\\/]+$/;

/** Turns gateway-style file notes (see attachments.ts fileNote) back into attachments. */
export function extractFileNotes(text: string): { text: string; attachments: MessageAttachment[] } {
  const attachments: MessageAttachment[] = [];
  const rest = text.replace(FILE_NOTE, (_match, what: string, name: string, filePath: string) => {
    const media = what.includes('audio') || what.includes('voice')
      ? 'audio'
      : what.includes('video')
        ? 'video'
        : what.includes('image')
          ? 'image'
          : what.includes('text')
            ? 'text'
            : 'document';
    const id = UPLOAD_PATH.exec(filePath)?.[1];
    attachments.push({ kind: 'file', name, media, ...(id !== undefined ? { url: `/api/uploads/${id}` } : {}) });
    return '';
  });
  return attachments.length === 0 ? { text, attachments } : { text: rest.trim(), attachments };
}

/** Splits plugin-injected context off the user's own words. */
export function splitInjected(text: string): { text: string; injected?: string } {
  const match = INJECTED_MARKER.exec(text);
  if (match === null) return { text };
  return { text: text.slice(0, match.index).trim(), injected: text.slice(match.index).trim() };
}

export function historyToItems(rows: MessageRow[], storedImages: StoredImage[] = []): TranscriptItem[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const items: TranscriptItem[] = [];
  const groups = new Map<number, StoredImage[]>();
  for (const image of storedImages) {
    groups.set(image.sent_at, [...(groups.get(image.sent_at) ?? []), image].sort((a, b) => a.position - b.position));
  }
  let pendingCalls: { id: string | null; name: string }[] = [];
  for (const row of sorted) {
    if (row.role === 'assistant') {
      pendingCalls = toolCallNames(row.tool_calls);
    }
    if (row.reasoning !== null && row.reasoning !== undefined && row.reasoning !== '') {
      items.push({ kind: 'reasoning', id: `history-rsn-${row.id}`, text: row.reasoning });
    }
    const timestamp = typeof row.timestamp === 'number' ? row.timestamp : undefined;
    if (row.role === 'user') {
      const split = splitContent(row.content);
      const restored = restoreImages(split.text, timestamp, groups);
      const steered = extractSteers(restored.text);
      const files = extractFileNotes(steered.text);
      const { text, injected } = splitInjected(files.text);
      const attachments = [...split.attachments, ...restored.attachments, ...files.attachments];
      if (text !== '' || attachments.length > 0 || steered.steers.length === 0) {
        items.push({
          kind: 'message',
          id: `history-${row.id}`,
          role: 'user',
          content: text,
          timestamp,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(injected !== undefined ? { injected } : {}),
        });
      }
      steered.steers.forEach((steer, index) =>
        items.push({ kind: 'message', id: `history-steer-${row.id}-${index}`, role: 'user', content: steer, timestamp, steer: true }),
      );
    } else if (row.role === 'tool') {
      const byId = pendingCalls.findIndex((call) => call.id !== null && call.id === row.tool_call_id);
      const [call] = pendingCalls.splice(byId === -1 ? 0 : byId, 1);
      const raw = typeof row.content === 'string' ? row.content : JSON.stringify(row.content);
      const steered = extractSteers(raw);
      items.push({
        kind: 'tool',
        id: `history-tool-${row.id}`,
        name: row.tool_name ?? call?.name ?? 'tool',
        state: 'completed',
        preview: steered.text,
      });
      steered.steers.forEach((steer, index) =>
        items.push({ kind: 'message', id: `history-steer-${row.id}-${index}`, role: 'user', content: steer, timestamp, steer: true }),
      );
    } else if (row.role === 'system') {
      items.push({
        kind: 'system',
        id: `history-sys-${row.id}`,
        title: 'System notice',
        detail: typeof row.content === 'string' ? row.content : '',
        tone: 'info',
      });
    } else {
      items.push({
        kind: 'message',
        id: `history-${row.id}`,
        role: 'assistant',
        content: splitContent(row.content).text,
        timestamp,
      });
    }
  }
  return items;
}
