import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../lib/api';
import { historyToItems, splitContent } from './history';

const row = (partial: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role'>): MessageRow => ({
  content: '',
  timestamp: 1000,
  reasoning: null,
  tool_calls: null,
  ...partial,
});

describe('historyToItems', () => {
  it('names tool results from the issuing assistant row by call id', () => {
    const items = historyToItems([
      row({ id: 2, role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'web_search' } }, { id: 'b', function: { name: 'terminal' } }] }),
      row({ id: 3, role: 'tool', tool_call_id: 'b', content: 'ok' }),
      row({ id: 4, role: 'tool', content: 'results' }),
      row({ id: 1, role: 'user', content: 'hi' }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['message', 'message', 'tool', 'tool']);
    expect(items[2]).toMatchObject({ kind: 'tool', name: 'terminal' });
    expect(items[3]).toMatchObject({ kind: 'tool', name: 'web_search' });
  });

  it('hides empty assistant turns but keeps reasoning and timestamps', () => {
    const items = historyToItems([row({ id: 1, role: 'assistant', content: '', reasoning: 'thinking' })]);
    expect(items[0]).toMatchObject({ kind: 'reasoning', text: 'thinking' });
    expect(items[1]).toMatchObject({ kind: 'message', role: 'assistant', content: '', timestamp: 1000 });
  });
});

describe('splitContent', () => {
  it('passes plain text through', () => {
    expect(splitContent('hello [world]')).toEqual({ text: 'hello [world]', attachments: [] });
  });

  it('extracts text and images from multimodal parts (array or JSON string)', () => {
    const parts = [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ];
    for (const content of [parts, JSON.stringify(parts)]) {
      const result = splitContent(content);
      expect(result.text).toBe('what is this?');
      expect(result.attachments).toEqual([{ kind: 'image', name: 'image 1', url: 'data:image/png;base64,AAAA' }]);
    }
  });
});
