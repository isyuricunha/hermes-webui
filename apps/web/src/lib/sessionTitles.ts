/**
 * WebUI-side derived session titles (Chat UX goal): the first meaningful user
 * message becomes the display title. Stored locally so historical Hermes
 * sessions are never mutated — Hermes-provided titles always win.
 */

const TITLES_KEY = 'hermes-webui:derived-titles';

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TITLES_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

/** True when the text is worth using as a title (not a bare command, not noise). */
export function isMeaningfulTitle(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (trimmed.startsWith('/')) return false;
  return true;
}

/** Derives a display title: whitespace collapsed, bounded, ellipsis at UI cut. */
export function deriveTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const clean = collapsed.length > 64 ? `${collapsed.slice(0, 61)}...` : collapsed;
  return clean;
}

/** Remembers a derived title for a session; the first one wins. */
export function rememberDerivedTitle(sessionId: string, text: string): void {
  if (!isMeaningfulTitle(text)) return;
  try {
    const map = readMap();
    if (map[sessionId] !== undefined) return;
    map[sessionId] = deriveTitle(text);
    localStorage.setItem(TITLES_KEY, JSON.stringify(map));
  } catch {
    // best-effort, WebUI-owned presentation state
  }
}

export function derivedTitle(sessionId: string): string | null {
  try {
    return readMap()[sessionId] ?? null;
  } catch {
    return null;
  }
}
