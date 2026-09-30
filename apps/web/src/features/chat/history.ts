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

export function historyToItems(rows: MessageRow[]): TranscriptItem[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const items: TranscriptItem[] = [];
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
      const { text, attachments } = splitContent(row.content);
      items.push({
        kind: 'message',
        id: `history-${row.id}`,
        role: 'user',
        content: text,
        timestamp,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } else if (row.role === 'tool') {
      const byId = pendingCalls.findIndex((call) => call.id !== null && call.id === row.tool_call_id);
      const [call] = pendingCalls.splice(byId === -1 ? 0 : byId, 1);
      items.push({
        kind: 'tool',
        id: `history-tool-${row.id}`,
        name: row.tool_name ?? call?.name ?? 'tool',
        state: 'completed',
        preview: typeof row.content === 'string' ? row.content : JSON.stringify(row.content),
      });
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
