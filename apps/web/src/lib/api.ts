import type { AppStatus, NormalizedCommand } from '@hermes-webui/shared';
import { getCsrfToken, notifyAuthRequired } from './auth';

/**
 * Browser-side access to the WebUI backend. The browser never talks to
 * Hermes directly (PRD 47): auth, secrets, normalization and the CLI bridge
 * all live behind this boundary.
 */

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // Phase 1 auth: session-bound CSRF token on every mutation (spec 2.12).
  if (method !== 'GET' && method !== 'HEAD') {
    const token = getCsrfToken();
    if (token !== null) {
      headers['x-csrf-token'] = token;
    }
  }
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    // Central 401 handling (spec 2.26): surface the login redirect globally.
    notifyAuthRequired();
  }
  if (!response.ok) {
    let message = `Request to ${url} failed with ${response.status}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) {
        message = body.error.message;
      }
      code = body.error?.code;
    } catch {
      // keep default message
    }
    const error = new Error(message) as Error & { statusCode?: number; errorCode?: string };
    error.statusCode = response.status;
    error.errorCode = code;
    throw error;
  }
  return (await response.json()) as T;
}

export function fetchAppStatus(): Promise<AppStatus> {
  return requestJson<AppStatus>('/api/app/status');
}

// --- Command catalog + session model (Chat UX) -------------------------------

export function fetchCommands(): Promise<{ commands: NormalizedCommand[] }> {
  return requestJson<{ commands: NormalizedCommand[] }>('/api/commands');
}

export function fetchSessionModel(
  sessionId: string,
): Promise<{ model: string | null; provider: string | null }> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/model`);
}

export function setSessionModel(
  sessionId: string,
  input: { model: string; provider?: string },
): Promise<unknown> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
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
  last_active?: number | null;
  ended_at?: number | null;
  pinned?: boolean;
  archived?: boolean;
  tool_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  estimated_cost_usd?: number | null;
  parent_session_id?: string | null;
}

export function fetchSessionDetail(sessionId: string): Promise<{ session: SessionRow }> {
  return requestJson<{ session: SessionRow }>(`/api/sessions/${encodeURIComponent(sessionId)}`);
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
  role: 'user' | 'assistant' | 'tool' | 'system' | 'commentary';
  /** Text, or multimodal parts (text + image_url) for vision turns. */
  content: string | unknown[];
  timestamp: number;
  reasoning: string | null;
  tool_calls: unknown;
  /** Present on role "tool" rows: the assistant call this result answers. */
  tool_call_id?: string | null;
  tool_name?: string | null;
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
  error?: string;
  last_event?: string;
  completed?: boolean;
}

export type RunInput =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export function createRun(input: RunInput, sessionId?: string): Promise<RunCreated> {
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

// --- Cron --------------------------------------------------------------------

export interface CronJob {
  id: string;
  name: string;
  prompt?: string;
  script?: string | null;
  no_agent?: boolean;
  schedule?: { kind?: string; expr?: string; display?: string };
  schedule_display?: string;
  paused?: boolean;
  enabled?: boolean;
  state?: string | null;
  deliver?: string | null;
  model?: string | null;
  skills?: string[] | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
}

export interface CronJobList {
  jobs: CronJob[];
}

export function fetchCronJobs(): Promise<CronJobList> {
  return requestJson<CronJobList>('/api/cron/jobs');
}

export function runCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
}

export function pauseCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/pause`, { method: 'POST' });
}

export function resumeCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' });
}

export function deleteCronJob(jobId: string): Promise<unknown> {
  return requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

// --- Settings (dashboard-backed) ---------------------------------------------

export interface RawConfig {
  yaml: string;
  path: string;
}

export function fetchConfigRaw(): Promise<RawConfig> {
  return requestJson<RawConfig>('/api/settings/config/raw');
}

export function putConfigRaw(yamlText: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/settings/config/raw', {
    method: 'PUT',
    body: JSON.stringify({ yaml_text: yamlText }),
  });
}

export function fetchConfigSchema(): Promise<{
  fields: Record<string, { type: string; description?: string; category?: string }>;
  category_order: string[];
}> {
  return requestJson('/api/settings/schema');
}

export function fetchSettingsConfig(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/settings/config');
}

export function fetchSettingsDefaults(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('/api/settings/defaults');
}

export function putSettingsConfig(config: Record<string, unknown>): Promise<unknown> {
  return requestJson('/api/settings/config', {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

export interface EnvVarInfo {
  is_set: boolean;
  redacted_value: string | null;
  description: string | null;
  category?: string;
  is_password?: boolean;
}

export function fetchEnv(): Promise<Record<string, EnvVarInfo>> {
  return requestJson<Record<string, EnvVarInfo>>('/api/settings/env');
}

export function putEnv(key: string, value: string): Promise<unknown> {
  return requestJson('/api/settings/env', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

export function deleteEnv(key: string): Promise<unknown> {
  return requestJson('/api/settings/env', { method: 'DELETE', body: JSON.stringify({ key }) });
}

export function fetchModelInfo(): Promise<{
  model: string;
  provider: string;
  effective_context_length?: number;
}> {
  return requestJson('/api/settings/model/info');
}

export function fetchModelOptions(): Promise<unknown> {
  return requestJson('/api/settings/model/options');
}

export interface McpServer {
  name: string;
  transport: string;
  url?: string | null;
  enabled: boolean;
  auth?: string | null;
}

export function fetchMcpServers(): Promise<{ servers: McpServer[] }> {
  return requestJson<{ servers: McpServer[] }>('/api/settings/mcp/servers');
}

export function setMcpServerEnabled(name: string, enabled: boolean): Promise<unknown> {
  return requestJson(`/api/settings/mcp/servers/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export function testMcpServer(name: string): Promise<unknown> {
  return requestJson(`/api/settings/mcp/servers/${encodeURIComponent(name)}/test`, {
    method: 'POST',
  });
}

export interface ModelAssignment {
  scope: 'main' | 'auxiliary';
  provider?: string;
  model: string;
  confirm_expensive_model?: boolean;
}

export function setModelAssignment(assignment: ModelAssignment): Promise<unknown> {
  return requestJson('/api/settings/model/set', {
    method: 'POST',
    body: JSON.stringify(assignment),
  });
}

export function forkSession(sessionId: string): Promise<{ session: { id: string } }> {
  return requestJson<{ session: { id: string } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export interface SkillInfo {
  name: string;
  description?: string;
}

export function fetchSkills(): Promise<SkillInfo[]> {
  return requestJson<SkillInfo[]>('/api/settings/skills');
}

export interface MessagingPlatforms {
  platforms: { id: string; name: string; description?: string }[];
}

export function fetchMessagingPlatforms(): Promise<MessagingPlatforms> {
  return requestJson<MessagingPlatforms>('/api/settings/messaging/platforms');
}

export function runDoctor(): Promise<unknown> {
  return requestJson<unknown>('/api/settings/ops/doctor', { method: 'POST' });
}

export function fetchUpdateCheck(): Promise<{
  current_version?: string;
  update_available?: boolean;
  can_apply?: boolean;
  message?: string;
}> {
  return requestJson('/api/settings/update/check');
}

export function applyUpdate(): Promise<unknown> {
  return requestJson<unknown>('/api/settings/update/apply', { method: 'POST' });
}

export interface LogLines {
  file: string;
  lines: string[];
}

export function fetchLogs(file: 'agent' | 'gateway' | 'errors', lines = 100): Promise<LogLines> {
  return requestJson<LogLines>(`/api/settings/logs?file=${file}&lines=${lines}`);
}

export function restartGateway(): Promise<unknown> {
  return requestJson<unknown>('/api/settings/gateway/restart', { method: 'POST' });
}

// --- CLI bridge (PRD 34-36) --------------------------------------------------

export interface BridgeCommandInfo {
  id: string;
  displayName: string;
  readOnly: boolean;
  mutating: boolean;
  requiresConfirmation: boolean;
}

export interface BridgeCatalog {
  commands: BridgeCommandInfo[];
  freeFormAllowlist: string[];
}

export interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  redacted: boolean;
}

export function fetchCliCatalog(): Promise<BridgeCatalog> {
  return requestJson<BridgeCatalog>('/api/cli/commands');
}

export function runCliCommand(id: string, confirm = false): Promise<BridgeResult> {
  return requestJson<BridgeResult>(`/api/cli/commands/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({ confirm }),
  });
}

export function runCliFreeForm(command: string): Promise<BridgeResult> {
  return requestJson<BridgeResult>('/api/cli/run', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}
