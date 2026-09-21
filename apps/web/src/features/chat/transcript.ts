import type { NormalizedRunEvent } from '@hermes-webui/shared';

/**
 * Transcript state: a pure reducer over normalized gateway events so the
 * streaming pipeline is unit-testable without a browser (PRD 60.1).
 */

export interface TranscriptMessage {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  reasoning?: string;
}

export interface TranscriptCommentary {
  kind: 'commentary';
  id: string;
  text: string;
}

export interface TranscriptTool {
  kind: 'tool';
  id: string;
  name: string;
  state: 'running' | 'completed' | 'failed';
  preview?: string;
  durationMs?: number;
  error?: string | null;
}

export interface TranscriptApproval {
  kind: 'approval';
  id: string;
  requestId?: string;
  tool?: string;
  command?: string;
  choices: string[];
  resolvedChoice?: string;
}

export interface TranscriptError {
  kind: 'error';
  id: string;
  message: string;
}

export type TranscriptItem =
  | TranscriptMessage
  | TranscriptCommentary
  | TranscriptTool
  | TranscriptApproval
  | TranscriptError;

export interface TranscriptState {
  items: TranscriptItem[];
  /** Terminal state of the run driving this transcript, if any. */
  runDone: boolean;
  runError?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export const emptyTranscript: TranscriptState = { items: [], runDone: false };

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Appends one normalized gateway event to the transcript. Unknown events are
 * ignored (forward compatibility), matching PRD 48.
 */
export function applyEvent(state: TranscriptState, frame: NormalizedRunEvent): TranscriptState {
  const items = [...state.items];
  switch (frame.type) {
    case 'message.delta': {
      const delta = String(frame.delta ?? '');
      const last = items[items.length - 1];
      if (last?.kind === 'message' && last.role === 'assistant' && last.streaming) {
        items[items.length - 1] = { ...last, content: last.content + delta };
      } else {
        items.push({ kind: 'message', id: nextId('msg'), role: 'assistant', content: delta, streaming: true });
      }
      return { ...state, items };
    }
    case 'message.interim': {
      items.push({ kind: 'commentary', id: nextId('cmt'), text: String(frame.text ?? '') });
      return { ...state, items };
    }
    case 'tool.started': {
      items.push({
        kind: 'tool',
        id: String(frame.tool_call_id ?? nextId('tool')),
        name: String(frame.tool ?? 'tool'),
        state: 'running',
        preview: frame.preview === undefined ? undefined : String(frame.preview),
      });
      return { ...state, items };
    }
    case 'tool.completed': {
      const toolId = String(frame.tool_call_id ?? '');
      const index = items.findIndex((item) => item.kind === 'tool' && item.id === toolId);
      if (index === -1) {
        return state;
      }
      const tool = items[index] as TranscriptTool;
      items[index] = {
        ...tool,
        state: frame.error ? 'failed' : 'completed',
        preview: frame.preview === undefined ? tool.preview : String(frame.preview),
        durationMs: typeof frame.duration === 'number' ? frame.duration : tool.durationMs,
        error: frame.error === undefined ? tool.error : String(frame.error),
      };
      return { ...state, items };
    }
    case 'reasoning.available': {
      const last = items[items.length - 1];
      if (last?.kind === 'message' && last.role === 'assistant') {
        items[items.length - 1] = { ...last, reasoning: String(frame.text ?? '') };
        return { ...state, items };
      }
      return state;
    }
    case 'approval.request': {
      items.push({
        kind: 'approval',
        id: String(frame.request_id ?? nextId('approval')),
        requestId: frame.request_id === undefined ? undefined : String(frame.request_id),
        tool: frame.tool === undefined ? undefined : String(frame.tool),
        command: frame.command === undefined ? undefined : String(frame.command),
        choices: Array.isArray(frame.choices) ? frame.choices.map(String) : ['once', 'deny'],
      });
      return { ...state, items };
    }
    case 'run.completed': {
      // Seal any open streaming message with the authoritative final output.
      const finalized: TranscriptItem[] = items.map((item) =>
        item.kind === 'message' && item.streaming
          ? { ...item, content: String(frame.output ?? item.content), streaming: false }
          : item,
      );
      return {
        ...state,
        items: finalized,
        runDone: true,
        usage: frame.usage as TranscriptState['usage'],
      };
    }
    case 'run.failed': {
      const finalized: TranscriptItem[] = items.map((item) =>
        item.kind === 'message' && item.streaming ? { ...item, streaming: false } : item,
      );
      return {
        ...state,
        items: finalized,
        runDone: true,
        runError: String(frame.error ?? 'The run failed.'),
      };
    }
    case 'run.cancelled':
    case 'run.interrupted': {
      const finalized: TranscriptItem[] = items.map((item) =>
        item.kind === 'message' && item.streaming ? { ...item, streaming: false } : item,
      );
      return { ...state, items: finalized, runDone: true };
    }
    default:
      return state;
  }
}
