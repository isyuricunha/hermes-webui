import { putSettingsConfig, requestJson } from './api';

/**
 * Hermes' write-approval queue (`/memory`, `/skills pending|approve|reject`)
 * through the server bridge (apps/server/src/hermes/writeApprovals.ts).
 */

export type ApprovalSubsystem = 'memory' | 'skills';

export interface PendingOperation {
  action: string | null;
  target: string | null;
  content: string | null;
  old_text: string | null;
  matched_entry: string | null;
}

export interface PendingWrite {
  id: string;
  action: string | null;
  summary: string | null;
  origin: string | null;
  created_at: number | null;
  operations?: PendingOperation[];
  diff?: string | null;
}

export interface PendingList {
  enabled: boolean;
  pending: PendingWrite[];
}

export const pendingWritesKey = (subsystem: ApprovalSubsystem) => ['write-approvals', subsystem] as const;

export const fetchPendingWrites = (subsystem: ApprovalSubsystem) =>
  requestJson<PendingList>(`/api/write-approvals/${subsystem}`);

export const resolvePendingWrite = (subsystem: ApprovalSubsystem, id: string, action: 'approve' | 'reject') =>
  requestJson<{ ok: boolean; message: string }>(
    `/api/write-approvals/${subsystem}/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  );

/** Turns the approval gate on/off (`<subsystem>.write_approval` in config.yaml). */
export const setWriteApproval = (subsystem: ApprovalSubsystem, enabled: boolean) =>
  putSettingsConfig({ [subsystem]: { write_approval: enabled } });

/** `{"staged": true, "pending_id": "…"}`: a tool result the approval gate held back. */
export function stagedWriteOf(toolName: string, payload: string | undefined): { subsystem: ApprovalSubsystem; id: string } | null {
  if (payload === undefined || !payload.includes('pending_id')) return null;
  try {
    const parsed = JSON.parse(payload) as { staged?: unknown; pending_id?: unknown };
    if (parsed.staged !== true || typeof parsed.pending_id !== 'string' || parsed.pending_id === '') return null;
    return { subsystem: /skill/i.test(toolName) ? 'skills' : 'memory', id: parsed.pending_id };
  } catch {
    return null;
  }
}
