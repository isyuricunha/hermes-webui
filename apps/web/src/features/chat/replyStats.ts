import type { ReplyStats, TranscriptItem } from './transcript';

/**
 * Per-reply token numbers exist only on the live `run.completed` event (Hermes
 * keeps session totals, not per message), so the WebUI remembers them in this
 * browser and puts them back on the matching reply when history reloads.
 */

export interface StoredReplyStats extends ReplyStats {
  /** When the run finished (ms since epoch). */
  at: number;
}

const KEY = (sessionId: string) => `hermes-webui:reply-stats:${sessionId}`;
const MAX_PER_SESSION = 200;

export function loadReplyStats(sessionId: string): StoredReplyStats[] {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId));
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    return Array.isArray(parsed) ? (parsed as StoredReplyStats[]).filter((entry) => typeof entry?.at === 'number') : [];
  } catch {
    return [];
  }
}

export function saveReplyStats(sessionId: string, entry: StoredReplyStats): void {
  try {
    const list = [...loadReplyStats(sessionId), entry].slice(-MAX_PER_SESSION);
    window.localStorage.setItem(KEY(sessionId), JSON.stringify(list));
  } catch {
    // storage full or blocked: the numbers just won't survive a reload
  }
}

/** Normalizes `run.completed` usage into reply stats. */
export function statsFromUsage(usage: unknown, timings: { firstTokenMs?: number; streamMs?: number }, model?: string): ReplyStats | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const num = (key: string) => (typeof record[key] === 'number' ? (record[key] as number) : undefined);
  const stats: ReplyStats = {
    input: num('input_tokens'),
    output: num('output_tokens'),
    cacheRead: num('cache_read_tokens'),
    cacheWrite: num('cache_write_tokens'),
    ...timings,
    ...(model !== undefined && model !== '' ? { model } : {}),
  };
  return stats.input === undefined && stats.output === undefined ? undefined : stats;
}

/**
 * Attaches stored stats to history: each entry goes to the last assistant
 * reply of the turn that finished closest before it (within 2 minutes).
 */
export function attachReplyStats(items: TranscriptItem[], stored: StoredReplyStats[]): TranscriptItem[] {
  if (stored.length === 0) return items;
  // Last assistant message of each turn (before the next non-steer user message).
  const finals: number[] = [];
  items.forEach((item, index) => {
    if (item.kind !== 'message') return;
    if (item.role === 'assistant') {
      const previous = finals[finals.length - 1];
      const turnBreak = items
        .slice(previous === undefined ? 0 : previous + 1, index)
        .some((between) => between.kind === 'message' && between.role === 'user' && between.steer !== true);
      if (previous !== undefined && !turnBreak) finals[finals.length - 1] = index;
      else finals.push(index);
    }
  });
  const result = [...items];
  const used = new Set<number>();
  for (const entry of stored) {
    let best: number | undefined;
    let bestDistance = Infinity;
    for (const index of finals) {
      if (used.has(index)) continue;
      const item = result[index];
      if (item?.kind !== 'message' || item.timestamp === undefined) continue;
      const distance = entry.at - item.timestamp * 1000;
      if (distance >= -15_000 && distance <= 120_000 && Math.abs(distance) < bestDistance) {
        best = index;
        bestDistance = Math.abs(distance);
      }
    }
    if (best !== undefined) {
      used.add(best);
      const item = result[best];
      if (item?.kind === 'message') {
        const stats: ReplyStats & { at?: number } = { ...entry };
        delete stats.at;
        result[best] = { ...item, stats };
      }
    }
  }
  return result;
}
