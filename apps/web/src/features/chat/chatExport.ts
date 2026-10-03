import type { SessionRow } from '../../lib/api';
import { derivedTitle } from '../../lib/sessionTitles';
import type { TranscriptItem } from './transcript';

export function displayTitle(
  session: Pick<SessionRow, 'id' | 'title'> | undefined,
  fallbackId?: string,
): string | null {
  const title = session?.title?.trim();
  if (title !== undefined && title !== '') return title;
  const id = session?.id ?? fallbackId;
  return (id !== undefined ? derivedTitle(id) : null) ?? null;
}

/** Transcript -> Markdown, for "Export as Markdown". */
export function transcriptToMarkdown(title: string, items: TranscriptItem[]): string {
  const lines = [`# ${title}`, ''];
  for (const item of items) {
    if (item.kind === 'message') {
      lines.push(`## ${item.role === 'user' ? 'You' : 'Hermes'}`, '', item.content, '');
    } else if (item.kind === 'tool') {
      lines.push(`> Tool: \`${item.name}\` (${item.state})`, '');
    } else if (item.kind === 'reasoning') {
      lines.push('<details><summary>Reasoning</summary>', '', item.text, '', '</details>', '');
    }
  }
  return lines.join('\n');
}
