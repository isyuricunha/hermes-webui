import type { NormalizedRunEvent } from '@hermes-webui/shared';

/**
 * Transcript state: a pure reducer over normalized gateway events so the
 * streaming pipeline is unit-testable without a browser (PRD 60.1).
 */

export interface MessageAttachment {
  kind: 'image' | 'file';
  name: string;
  /** Image data URL, or the download URL of an uploaded file. */
  url?: string;
  /** What an uploaded file is (drives the player/card). */
  media?: 'audio' | 'video' | 'image' | 'text' | 'document';
}

export interface TranscriptMessage {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  /** Unix seconds, when known. */
  timestamp?: number;
  attachments?: MessageAttachment[];
  /** Context a Hermes plugin appended to the user turn (shown collapsed). */
  injected?: string;
  /** A message sent while the agent was working (Hermes /steer). */
  steer?: boolean;
  /** Assistant text streamed before a steer message split the reply. */
  splitBySteer?: boolean;
  /** Tokens and speed of this reply (assistant, final message of a run). */
  stats?: ReplyStats;
}

/** Per-reply numbers from `run.completed` plus browser-side timings. */
export interface ReplyStats {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Time from send to the first streamed text (ms, browser-measured). */
  firstTokenMs?: number;
  /** Time spent streaming text (ms, browser-measured). */
  streamMs?: number;
  model?: string;
}

export interface TranscriptCommentary {
  kind: 'commentary';
  id: string;
  text: string;
}

/** Model reasoning, rendered as its own collapsed block (never merged with
 * tool output or the final answer). */
export interface TranscriptReasoning {
  kind: 'reasoning';
  id: string;
  text: string;
}

/** Result of a native WebUI slash command (never LLM-generated content). */
export interface TranscriptSystem {
  kind: 'system';
  id: string;
  title: string;
  detail?: string;
  tone: 'info' | 'success' | 'warning';
  /** Interactive body under the card (e.g. `/memory` pending writes). */
  widget?: 'memory-approvals';
  /** Terminal-style output from Hermes (monospace, scrollable). */
  mono?: boolean;
  /** The command is still running in Hermes. */
  pending?: boolean;
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
  | TranscriptReasoning
  | TranscriptSystem
  | TranscriptTool
  | TranscriptApproval
  | TranscriptError;

export interface TranscriptState {
  items: TranscriptItem[];
  /** Session this transcript belongs to (guards cross-session resets). */
  sessionId?: string;
  /** Terminal state of the run driving this transcript, if any. */
  runDone: boolean;
  runError?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
}

export const emptyTranscript: TranscriptState = { items: [], runDone: false };

/**
 * A message typed while the agent works goes to Hermes as a steer. Show it
 * at once: seal the text streamed so far (the reply continues below it).
 */
export function appendSteer(state: TranscriptState, text: string): TranscriptState {
  const items = state.items.map((item) =>
    item.kind === 'message' && item.role === 'assistant' && item.streaming
      ? { ...item, streaming: false, splitBySteer: true }
      : item,
  );
  items.push({ kind: 'message', id: nextId('steer'), role: 'user', content: text, timestamp: Date.now() / 1000, steer: true });
  return { ...state, items };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function findOpenToolIndex(items: TranscriptItem[], toolCallId: unknown, toolName: unknown): number {
  if (toolCallId !== undefined && toolCallId !== null && toolCallId !== '') {
    return items.findIndex((item) => item.kind === 'tool' && item.id === String(toolCallId));
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item?.kind === 'tool' &&
      item.state === 'running' &&
      (toolName === undefined || item.name === String(toolName))
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * Appends one normalized gateway event to the transcript. Unknown events are
 * ignored (forward compatibility), matching PRD 48.
 */
export function applyEvent(
  state: TranscriptState,
  frame: NormalizedRunEvent,
  _sessionId?: string,
): TranscriptState {
  const items = [...state.items];
  switch (frame.type) {
    case 'message.delta': {
      const delta = String(frame.delta ?? '');
      const last = items[items.length - 1];
      if (last?.kind === 'message' && last.role === 'assistant' && last.streaming) {
        items[items.length - 1] = { ...last, content: last.content + delta };
      } else {
        items.push({
          kind: 'message',
          id: nextId('msg'),
          role: 'assistant',
          content: delta,
          streaming: true,
          timestamp: Date.now() / 1000,
        });
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
      // The /v1/runs stream sends {tool, duration (seconds), error (bool)}
      // with no tool_call_id, so match by id when present, else close the
      // most recent still-running call of that tool.
      const index = findOpenToolIndex(items, frame.tool_call_id, frame.tool);
      if (index === -1) {
        return state;
      }
      const tool = items[index] as TranscriptTool;
      const failed = frame.error === true || (typeof frame.error === 'string' && frame.error !== '');
      items[index] = {
        ...tool,
        state: failed ? 'failed' : 'completed',
        preview: frame.preview === undefined ? tool.preview : String(frame.preview),
        durationMs: typeof frame.duration === 'number' ? frame.duration * 1000 : tool.durationMs,
        error: typeof frame.error === 'string' && frame.error !== '' ? frame.error : tool.error,
      };
      return { ...state, items };
    }
    case 'reasoning.available': {
      const text = String(frame.text ?? '');
      if (text === '') return state;
      const last = items[items.length - 1];
      // Consecutive reasoning chunks merge into one collapsible block.
      if (last?.kind === 'reasoning') {
        items[items.length - 1] = { ...last, text: last.text + text };
        return { ...state, items };
      }
      items.push({ kind: 'reasoning', id: nextId('rsn'), text });
      return { ...state, items };
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
      // Seal the open streaming message with the authoritative final output;
      // if none exists (late reconnect after the run finished), create the
      // assistant message from the run output so the answer is never lost.
      // Text streamed before a steer message already sits above it, so the
      // part after the steer only keeps what the final output adds.
      const output = frame.output === undefined ? undefined : String(frame.output);
      const lastStreaming = items.map((item) => item.kind === 'message' && item.role === 'assistant' && item.streaming).lastIndexOf(true);
      let finalized: TranscriptItem[];
      if (lastStreaming !== -1) {
        let prefix = '';
        for (let index = lastStreaming - 1; index >= 0; index -= 1) {
          const item = items[index];
          if (item?.kind === 'message' && item.role === 'user' && item.steer !== true) break;
          if (item?.kind === 'message' && item.splitBySteer === true) prefix = item.content + prefix;
        }
        finalized = items.map((item, index) => {
          if (item.kind !== 'message' || !item.streaming) return item;
          if (index !== lastStreaming) return { ...item, streaming: false };
          let content = output ?? item.content;
          if (prefix !== '' && content.startsWith(prefix)) content = content.slice(prefix.length).replace(/^\s+/, '');
          return { ...item, content, streaming: false };
        });
      } else {
        finalized = [
          ...items,
          {
            kind: 'message',
            id: `final-${frame.runId}`,
            role: 'assistant' as const,
            content: output ?? '',
          },
        ];
      }
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
