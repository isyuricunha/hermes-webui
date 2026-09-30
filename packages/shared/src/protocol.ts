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
  /** Absent on the /v1/runs stream (api_server_runs.py): match by tool name. */
  tool_call_id?: string;
  /** Seconds (rounded to ms by the gateway). */
  duration?: number;
  /** The /v1/runs stream sends a boolean; other surfaces may send a message. */
  error?: boolean | string | null;
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
 * Parses one SSE frame from the gateway. Frames are `data:`-only JSON with
 * the event name in `.event` (verified live); `: keepalive` comments and
 * empty frames yield null.
 *
 * Accepts either a raw frame (`data: {...}`) or the bare payload that
 * `EventSource.onmessage` hands over, which has the `data:` prefix stripped.
 */
export function parseGatewayFrame(raw: string): NormalizedRunEvent | null {
  const lines = raw.split('\n');
  const payloads = lines.some((line) => line.startsWith('data:'))
    ? lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5))
    : [raw];
  for (const candidate of payloads) {
    const payload = candidate.trim();
    if (payload === '' || payload === '[DONE]' || payload.startsWith(':')) {
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
