import type { AppStatus } from '@hermes-webui/shared';

/**
 * Browser-side access to the WebUI backend. The browser never talks to
 * Hermes directly (PRD 47): auth, secrets, normalization and the CLI bridge
 * all live behind this boundary.
 */

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Request to ${url} failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) {
        message = body.error.message;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function fetchAppStatus(): Promise<AppStatus> {
  return requestJson<AppStatus>('/api/app/status');
}

// --- Sessions ----------------------------------------------------------------

export interface SessionRow {
  id: string;
  title: string | null;
  source: string;
  model: string | null;
  started_at: number;
  message_count: number;
  preview?: string | null;
}

export interface SessionListResponse {
  object: 'list';
  data: SessionRow[];
}

export function fetchSessions(limit = 50): Promise<SessionListResponse> {
  return requestJson<SessionListResponse>(`/api/sessions?limit=${limit}`);
}

export function createSession(body: { id?: string; title?: string }): Promise<{ session: SessionRow }> {
  return requestJson<{ session: SessionRow }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchSession(
  sessionId: string,
  body: { title?: string; pinned?: boolean; archived?: boolean },
): Promise<unknown> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteSession(sessionId: string): Promise<unknown> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

// --- Messages ----------------------------------------------------------------

export interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  reasoning: string | null;
  tool_calls: unknown;
}

export interface MessageListResponse {
  object: 'list';
  data: MessageRow[];
}

export function fetchSessionMessages(sessionId: string): Promise<MessageListResponse> {
  return requestJson<MessageListResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
}

// --- Runs --------------------------------------------------------------------

export interface RunCreated {
  run_id: string;
  status: string;
}

export interface RunStatus {
  object: 'hermes.run';
  run_id: string;
  status: string;
  session_id?: string;
  output?: string;
  last_event?: string;
  completed?: boolean;
}

export function createRun(input: string, sessionId?: string): Promise<RunCreated> {
  return requestJson<RunCreated>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ input, ...(sessionId ? { session_id: sessionId } : {}) }),
  });
}

export function fetchRun(runId: string): Promise<RunStatus> {
  return requestJson<RunStatus>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function stopRun(runId: string): Promise<unknown> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}

export function steerRun(runId: string, input: string): Promise<unknown> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/steer`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export function resolveApproval(
  runId: string,
  body: { choice: 'once' | 'session' | 'always' | 'deny'; request_id?: string; all?: boolean },
): Promise<unknown> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
