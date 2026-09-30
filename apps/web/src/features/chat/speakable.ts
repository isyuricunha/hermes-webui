import { stripMediaTags } from '@hermes-webui/shared';

/** Markdown -> speakable text (code blocks are summarized, not read out; file tags are skipped). */
export function speakable(markdown: string): string {
  return stripMediaTags(markdown)
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}
