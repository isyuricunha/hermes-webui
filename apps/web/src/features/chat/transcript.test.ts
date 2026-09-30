import { describe, expect, it } from 'vitest';
import { applyEvent, emptyTranscript } from './transcript';
import type { NormalizedRunEvent } from '@hermes-webui/shared';

function frame(type: string, extra: Record<string, unknown> = {}): NormalizedRunEvent {
  return { type, runId: 'r1', ...extra } as unknown as NormalizedRunEvent;
}

describe('transcript reducer', () => {
  it('assembles streamed deltas into one assistant message and seals it on completion', () => {
    let state = emptyTranscript;
    state = applyEvent(state, frame('message.delta', { delta: 'hel' }));
    state = applyEvent(state, frame('message.delta', { delta: 'lo' }));
    expect(state.items).toHaveLength(1);
    const message = state.items[0]!;
    expect(message).toMatchObject({ kind: 'message', role: 'assistant', content: 'hello', streaming: true });

    state = applyEvent(state, frame('run.completed', { output: 'hello world' }));
    expect(state.items[0]).toMatchObject({ content: 'hello world', streaming: false });
    expect(state.runDone).toBe(true);
  });

  it('tracks tool lifecycle and failures', () => {
    let state = applyEvent(emptyTranscript, frame('tool.started', { tool: 'terminal', tool_call_id: 't1', preview: 'ls' }));
    state = applyEvent(state, frame('tool.completed', { tool: 'terminal', tool_call_id: 't1', duration: 0.43, preview: 'file.txt' }));
    expect(state.items[0]).toMatchObject({ kind: 'tool', name: 'terminal', state: 'completed', preview: 'file.txt', durationMs: 430 });

    state = applyEvent(state, frame('tool.started', { tool: 'terminal', tool_call_id: 't2' }));
    state = applyEvent(state, frame('tool.completed', { tool: 'terminal', tool_call_id: 't2', error: 'boom' }));
    expect(state.items[1]).toMatchObject({ kind: 'tool', state: 'failed', error: 'boom' });
  });

  // Live /v1/runs shape (api_server_runs.py): no tool_call_id, duration in
  // seconds, error as a boolean.
  it('closes id-less tool calls by name, most recent first', () => {
    let state = applyEvent(emptyTranscript, frame('tool.started', { tool: 'terminal', preview: 'ls' }));
    state = applyEvent(state, frame('tool.started', { tool: 'web_search', preview: 'hermes' }));
    state = applyEvent(state, frame('tool.completed', { tool: 'terminal', duration: 1.25, error: false }));
    expect(state.items[0]).toMatchObject({ name: 'terminal', state: 'completed', durationMs: 1250 });
    expect(state.items[0]).not.toHaveProperty('error', 'false');
    expect(state.items[1]).toMatchObject({ name: 'web_search', state: 'running' });

    state = applyEvent(state, frame('tool.completed', { tool: 'web_search', duration: 0.2, error: true }));
    expect(state.items[1]).toMatchObject({ name: 'web_search', state: 'failed' });
  });

  it('records interim commentary, approvals and failures', () => {
    let state = applyEvent(emptyTranscript, frame('message.interim', { text: 'checking gateway' }));
    state = applyEvent(state, frame('approval.request', { request_id: 'a1', command: 'rm -rf ./cache', choices: ['once', 'deny'] }));
    state = applyEvent(state, frame('run.failed', { error: 'denied' }));
    expect(state.items[0]).toMatchObject({ kind: 'commentary', text: 'checking gateway' });
    expect(state.items[1]).toMatchObject({ kind: 'approval', command: 'rm -rf ./cache' });
    expect(state.runDone).toBe(true);
    expect(state.runError).toBe('denied');
  });

  it('creates the assistant message on late run.completed (reconnect after finish)', () => {
    // No streaming message was ever received (events missed, run finished).
    const state = applyEvent(emptyTranscript, frame('run.completed', { output: 'the answer' }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: 'message', role: 'assistant', content: 'the answer' });
    expect(state.runDone).toBe(true);
  });

  it('ignores unknown events for forward compatibility', () => {
    const state = applyEvent(emptyTranscript, frame('something.new' as string));
    expect(state.items).toHaveLength(0);
  });
});
