/**
 * Normalized run-event protocol (PRD 48). The WebUI backend passes the
 * gateway's SSE frames through; the frontend parses `data:` JSON payloads
 * (gateway frames carry the event name inside the JSON, in `.event`) and
 * normalizes them into these shapes so React components never depend on
 * gateway protocol details.
 *
 * Gateway reference: docs/HERMES-CAPABILITY-MATRIX.md section 2.
 * Live frame evidence: data-only JSON frames, event name in `.event`.
 */

export type WebUiEventType =
  | 'message.delta'
  | 'message.interim'
  | 'tool.started'
  | 'tool.completed'
  | 'reasoning.available'
  | 'approval.request'
  | 'approval.responded'
  | 'run.stopping'
  | 'run.steered'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.interrupted';

export interface BaseEvent<TType extends WebUiEventType = WebUiEventType> {
  type: TType;
  /** Gateway run this event belongs to. */
  runId: string;
  /** Unix seconds when the gateway emitted the event. */
  timestamp?: number;
}

export interface MessageDeltaEvent extends BaseEvent<'message.delta'> {
  delta: string;
}

export interface MessageInterimEvent extends BaseEvent<'message.interim'> {
  text: string;
}

export interface ToolStartedEvent extends BaseEvent<'tool.started'> {
  tool: string;
  tool_call_id?: string;
  preview?: string;
}

export interface ToolCompletedEvent extends BaseEvent<'tool.completed'> {
  tool: string;
  tool_call_id?: string;
  duration?: number;
  error?: string | null;
  preview?: string;
}

export interface ReasoningAvailableEvent extends BaseEvent<'reasoning.available'> {
  text: string;
}

export interface ApprovalRequestEvent extends BaseEvent<'approval.request'> {
  request_id?: string;
  tool?: string;
  command?: string;
  choices?: string[];
}

export interface RunCompletedEvent extends BaseEvent<'run.completed'> {
  output: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface RunFailedEvent extends BaseEvent<'run.failed'> {
  error?: string;
}

export type NormalizedRunEvent =
  | MessageDeltaEvent
  | MessageInterimEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ReasoningAvailableEvent
  | ApprovalRequestEvent
  | RunCompletedEvent
  | RunFailedEvent
  | (BaseEvent<Exclude<WebUiEventType, 'message.delta' | 'message.interim' | 'tool.started' | 'tool.completed' | 'reasoning.available' | 'approval.request' | 'run.completed' | 'run.failed'>> &
      Record<string, unknown>);

/**
 * Parses one raw SSE frame from the gateway. Frames are `data:`-only JSON
 * with the event name in `.event` (verified live); `: keepalive` comments and
 * empty frames yield null.
 */
export function parseGatewayFrame(raw: string): NormalizedRunEvent | null {
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') {
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as {
        event?: unknown;
        run_id?: unknown;
      } & Record<string, unknown>;
      if (typeof parsed.event !== 'string') {
        return null;
      }
      const { event, run_id, ...rest } = parsed;
      // Gateway sends snake_case run_id; normalize to the protocol shape.
      return { type: event, runId: run_id, ...rest } as unknown as NormalizedRunEvent;
    } catch {
      return null;
    }
  }
  return null;
}
