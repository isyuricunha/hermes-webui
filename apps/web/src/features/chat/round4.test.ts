import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../lib/api';
import { extractFileNotes, extractSteers, historyToItems } from './history';
import { appendSteer, applyEvent, emptyTranscript, type TranscriptState } from './transcript';
import { attachReplyStats, statsFromUsage } from './replyStats';
import { buildRunInput, fileNote, type PendingAttachment } from './attachments';
import { humanKey, readableText } from './ReadablePayload';
import { tokensPerSecond } from './MessageView';

const row = (partial: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role'>): MessageRow => ({
  content: '',
  timestamp: 1000,
  reasoning: null,
  tool_calls: null,
  ...partial,
});

const STEER = '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered mid-run]\nRejeitei as que você colocou.\n[/OUT-OF-BAND USER MESSAGE]';

describe('steer messages', () => {
  it('fold the out-of-band marker into a steer bubble after a reload', () => {
    expect(extractSteers(STEER)).toEqual({ text: '', steers: ['Rejeitei as que você colocou.'] });
    const items = historyToItems([
      row({ id: 1, role: 'user', content: 'faz a lista' }),
      row({ id: 2, role: 'tool', content: `{"ok":true}\n\n${STEER}` }),
      row({ id: 3, role: 'user', content: STEER }),
    ]);
    const messages = items.filter((item) => item.kind === 'message');
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ role: 'user', content: 'Rejeitei as que você colocou.', steer: true });
    expect(JSON.stringify(items)).not.toContain('OUT-OF-BAND');
  });

  it('show at once and keep the reply from repeating what streamed before them', () => {
    let state: TranscriptState = { ...emptyTranscript, sessionId: 's' };
    state = applyEvent(state, { type: 'message.delta', runId: 'r', delta: 'Vou listar ' });
    state = appendSteer(state, 'só as pastas');
    state = applyEvent(state, { type: 'message.delta', runId: 'r', delta: 'as pastas:' });
    state = applyEvent(state, { type: 'run.completed', runId: 'r', output: 'Vou listar as pastas: a, b' });
    const shown = state.items.filter((item) => item.kind === 'message').map((item) => (item.kind === 'message' ? [item.role, item.content] : []));
    expect(shown).toEqual([
      ['assistant', 'Vou listar '],
      ['user', 'só as pastas'],
      ['assistant', 'as pastas: a, b'],
    ]);
  });
});

describe('attachments of any type', () => {
  const upload = { id: 'u', name: 'reunião.mp3', size: 10, mime: 'audio/mpeg', kind: 'audio' as const, path: '/data/uploads/0b7c1b8e-1111-4222-8333-944445555666/reunião.mp3', url: '/api/uploads/0b7c1b8e-1111-4222-8333-944445555666' };
  const file: PendingAttachment = { id: '1', kind: 'file', name: upload.name, size: 10, upload };

  it('carry the same note Hermes writes for Telegram files, before the text', () => {
    const input = buildRunInput('transcreve pra mim', [file]);
    expect(typeof input).toBe('string');
    expect(input).toMatch(/^\[The user sent an audio file attachment: 'reunião\.mp3'\. It is saved at: \/data\/uploads\/.+reunião\.mp3\. /);
    expect(String(input).endsWith('transcreve pra mim')).toBe(true);
    expect(fileNote({ ...upload, kind: 'document', name: 'a.pdf' })).toContain('binary format such as PDF');
  });

  it('come back as a playable attachment from history', () => {
    const { text, attachments } = extractFileNotes(`${fileNote(upload)}\n\ntranscreve pra mim`);
    expect(text).toBe('transcreve pra mim');
    expect(attachments).toEqual([{ kind: 'file', name: 'reunião.mp3', media: 'audio', url: upload.url }]);
  });
});

describe('per-reply stats', () => {
  it('normalize run usage and estimate speed only when meaningful', () => {
    const stats = statsFromUsage({ input_tokens: 1200, output_tokens: 300, cache_read_tokens: 800 }, { streamMs: 3000 }, 'glm');
    expect(stats).toMatchObject({ input: 1200, output: 300, cacheRead: 800, model: 'glm' });
    expect(tokensPerSecond(stats!)).toBe(100);
    expect(tokensPerSecond({ output: 5, streamMs: 100 })).toBeNull();
    expect(statsFromUsage({}, {})).toBeUndefined();
  });

  it('go back on the last reply of the matching turn', () => {
    const items = historyToItems([
      row({ id: 1, role: 'user', content: 'a', timestamp: 100 }),
      row({ id: 2, role: 'assistant', content: 'working', timestamp: 105 }),
      row({ id: 3, role: 'assistant', content: 'done', timestamp: 110 }),
      row({ id: 4, role: 'user', content: 'b', timestamp: 200 }),
      row({ id: 5, role: 'assistant', content: 'ok', timestamp: 205 }),
    ]);
    const withStats = attachReplyStats(items, [{ at: 111_000, output: 7 }, { at: 206_000, output: 9 }]);
    const byContent = Object.fromEntries(
      withStats.flatMap((item) => (item.kind === 'message' ? [[item.content, item.stats?.output]] : [])),
    );
    expect(byContent).toMatchObject({ working: undefined, done: 7, ok: 9 });
  });
});

describe('readable tool output', () => {
  it('labels keys and restores escaped line breaks', () => {
    expect(humanKey('exit_code')).toBe('Exit code');
    expect(humanKey('tokenCount')).toBe('Token count');
    expect(readableText('line1\\nline2')).toBe('line1\nline2');
    expect(readableText('real\nbreak \\n kept')).toBe('real\nbreak \\n kept');
  });
});
