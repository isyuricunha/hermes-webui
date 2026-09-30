/** Window events that decouple global UI surfaces (palette, shortcuts, sidebar). */
export const OPEN_SHORTCUTS_EVENT = 'hermes-webui:open-shortcuts';
export const OPEN_PALETTE_EVENT = 'hermes-webui:open-palette';
export const TOGGLE_SIDEBAR_EVENT = 'hermes-webui:toggle-sidebar';
export const FOCUS_COMPOSER_EVENT = 'hermes-webui:focus-composer';

/** True when the user is typing somewhere a bare key should not be hijacked. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
