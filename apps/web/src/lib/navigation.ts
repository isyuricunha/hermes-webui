import type { NavigateOptions } from '@tanstack/react-router';

/**
 * Top-level navigation between Chat and Settings (PRD 6.2 workspaces).
 *
 * Chat session preservation: the last visited session id is remembered so
 * returning to Chat from Settings restores the same conversation instead of
 * opening a new one. Plain localStorage, no custom history; Back/Forward and
 * deep links keep their normal browser semantics.
 */
const LAST_SESSION_KEY = 'hermes-webui:last-chat-session';

export function rememberChatSession(sessionId: string | undefined): void {
  if (sessionId === undefined) return;
  try {
    window.localStorage.setItem(LAST_SESSION_KEY, sessionId);
  } catch {
    // Private/blocked storage: session preservation degrades gracefully.
  }
}

export function lastChatSession(): string | null {
  try {
    return window.localStorage.getItem(LAST_SESSION_KEY);
  } catch {
    return null;
  }
}

/** Returns the chat route that restores the last active session, if any. */
export function chatTarget(): string {
  const session = lastChatSession();
  return session !== null ? `/chat/${session}` : '/';
}

/** Navigates back to Chat, restoring the last active session when possible. */
export function goToChat(navigate: (options: NavigateOptions) => void): void {
  void navigate({ href: chatTarget() });
}