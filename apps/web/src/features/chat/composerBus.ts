/** Other surfaces (edit message, prompt starters) put text into the composer. */
export const COMPOSER_INSERT_EVENT = 'hermes-webui:composer-insert';

export function insertIntoComposer(text: string): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail: { text } }));
}
