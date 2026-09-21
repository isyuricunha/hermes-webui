/**
 * Normalized event protocol between the WebUI backend and the frontend.
 *
 * Hermes-specific events are normalized into this stable protocol by the
 * backend (PRD section 48) so React components are decoupled from small
 * protocol changes in Hermes. Raw Hermes events remain accessible for debug
 * purposes alongside each normalized event.
 *
 * This file is a scaffold: the concrete event payloads are filled in from
 * docs/HERMES-CAPABILITY-MATRIX.md once the real Hermes protocol is mapped.
 */

export type WebUiEventType =
  | 'message.delta'
  | 'commentary.delta'
  | 'tool.started'
  | 'tool.output'
  | 'tool.completed'
  | 'approval.requested'
  | 'run.completed'
  | 'run.failed';

export interface BaseEvent<TType extends WebUiEventType = WebUiEventType> {
  type: TType;
  /** WebUI-generated id for correlation across reconnects. */
  eventId: string;
  /** Hermes run this event belongs to. */
  runId: string;
  /** Hermes session this event belongs to. */
  sessionId: string;
  /** Unix ms when the WebUI received the event. */
  receivedAt: number;
}

export interface NormalizedEvent extends BaseEvent {
  /** Raw Hermes event payload, kept for debug views. */
  raw: unknown;
}
