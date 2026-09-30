import { requestJson } from './api';

/**
 * Typed client for the allowlisted dashboard proxy (`/api/hx/*`, see
 * apps/server/src/routes/hermesProxy.ts). Shapes mirror the Hermes
 * dashboard's own frontend types (web/src/lib/api.ts in hermes-agent).
 */

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// --- Analytics ---------------------------------------------------------------

export interface AnalyticsDailyEntry {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsSkillEntry {
  skill: string;
  view_count: number;
  manage_count: number;
  total_count: number;
  percentage: number;
  last_used_at: number | null;
}

export interface AnalyticsResponse {
  daily: AnalyticsDailyEntry[];
  by_model: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    estimated_cost: number;
    sessions: number;
    api_calls: number;
  }[];
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  skills?: {
    summary: {
      total_skill_loads: number;
      total_skill_edits: number;
      total_skill_actions: number;
      distinct_skills_used: number;
    };
    top_skills: AnalyticsSkillEntry[];
  };
}

export interface ModelsAnalyticsEntry {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls: number;
  last_used_at: number;
  avg_tokens_per_session: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

export interface ModelsAnalyticsResponse {
  models: ModelsAnalyticsEntry[];
  period_days: number;
}

export const fetchUsageAnalytics = (days: number) =>
  requestJson<AnalyticsResponse>(`/api/hx/analytics/usage?days=${days}`);
export const fetchModelsAnalytics = (days: number) =>
  requestJson<ModelsAnalyticsResponse>(`/api/hx/analytics/models?days=${days}`);

// --- Sessions (search, stats, export) ----------------------------------------

export interface SessionSearchResult {
  session_id: string;
  id?: string;
  title: string | null;
  source: string | null;
  snippet: string;
  role: string | null;
  session_started: number | null;
  started_at?: number;
  model?: string | null;
}

export interface SessionStoreStats {
  total: number;
  active_store: number;
  archived: number;
  messages: number;
  by_source: Record<string, number>;
}

export const searchSessions = (q: string, limit = 20) =>
  requestJson<{ results: SessionSearchResult[] }>(
    `/api/hx/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
export const fetchSessionStats = () => requestJson<SessionStoreStats>('/api/hx/sessions/stats');
export const sessionExportUrl = (id: string) => `/api/hx/sessions/${encodeURIComponent(id)}/export`;

// --- Memory / curator -----------------------------------------------------------

export interface MemoryProviderInfo {
  name: string;
  description: string;
  available: boolean;
  configured: boolean;
  status: 'ready' | 'needs_config' | 'unavailable' | 'missing';
}

export interface MemoryStatus {
  active: string;
  providers: MemoryProviderInfo[];
  builtin_files: { memory: number; user: number };
}

export interface CuratorStatus {
  enabled: boolean;
  paused: boolean;
  interval_hours: number | null;
  last_run_at: string | null;
  min_idle_hours: number | null;
  stale_after_days: number | null;
  archive_after_days: number | null;
}

export const fetchMemory = () => requestJson<MemoryStatus>('/api/hx/memory');
export const fetchCurator = () => requestJson<CuratorStatus>('/api/hx/curator');
export const setCuratorPaused = (paused: boolean) =>
  requestJson<{ ok: boolean; paused: boolean }>('/api/hx/curator/paused', { method: 'PUT', ...json({ paused }) });

// --- Skills / toolsets ---------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  /** Where Hermes says the skill came from: bundled (ships with Hermes), hub (Skills Hub), agent (local). */
  provenance?: 'bundled' | 'hub' | 'agent' | string;
  usage?: number;
}

/** Lists come back bare or wrapped (`{skills: [...]}`) depending on the Hermes version. */
function listOf<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const inner = (payload as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export const fetchSkillList = () => requestJson<unknown>('/api/hx/skills').then((data) => listOf<SkillInfo>(data, 'skills'));
export const fetchSkillContent = (name: string) =>
  requestJson<{ name: string; content: string; path: string }>(
    `/api/hx/skills/content?name=${encodeURIComponent(name)}`,
  );
export const toggleSkill = (name: string, enabled: boolean) =>
  requestJson<{ ok: boolean }>('/api/hx/skills/toggle', { method: 'PUT', ...json({ name, enabled }) });

export interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  platform: string;
  platform_label: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

export const fetchToolsets = () =>
  requestJson<unknown>('/api/hx/tools/toolsets').then((data) => listOf<ToolsetInfo>(data, 'toolsets'));
export const toggleToolset = (name: string, enabled: boolean) =>
  requestJson<{ ok: boolean; enabled: boolean }>(`/api/hx/tools/toolsets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    ...json({ enabled }),
  });

// --- Profiles ----------------------------------------------------------------------

export interface ProfileInfo {
  name: string;
  path: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  skill_count: number;
  gateway_running: boolean;
  description: string;
  display_name?: string;
}

export const fetchProfiles = () => requestJson<{ profiles: ProfileInfo[] }>('/api/hx/profiles');
export const fetchActiveProfile = () => requestJson<{ active: string; current: string }>('/api/hx/profiles/active');
export const fetchSoul = (name: string) =>
  requestJson<{ content: string; exists: boolean }>(`/api/hx/profiles/${encodeURIComponent(name)}/soul`);
export const saveSoul = (name: string, content: string) =>
  requestJson<{ ok: boolean }>(`/api/hx/profiles/${encodeURIComponent(name)}/soul`, {
    method: 'PUT',
    ...json({ content }),
  });

// --- Cron history ----------------------------------------------------------------

export interface CronRun {
  id: string;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  preview: string | null;
  input_tokens?: number;
  output_tokens?: number;
}

export const fetchCronRuns = (jobId: string, limit = 10) =>
  requestJson<{ runs: CronRun[] }>(`/api/hx/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`);

// --- System ------------------------------------------------------------------------

export interface PlatformStatus {
  state: string;
  updated_at: string;
  error_code?: string;
  error_message?: string;
}

export interface HermesStatus {
  version: string;
  release_date: string;
  active_sessions?: number;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_pid?: number | null;
  gateway_platforms: Record<string, PlatformStatus>;
  gateway_updated_at: string | null;
  gateway_exit_reason?: string | null;
  config_version?: number;
  latest_config_version?: number;
  hermes_home?: string;
  profiles?: string[];
  memory?: { pressure: string; gateway_rss_mb?: number | null; system_total_mb?: number | null; system_available_mb?: number | null };
  disk?: { pressure: string; total_mb?: number | null; free_mb?: number | null; used_percent?: number | null };
}

export interface SystemStats {
  os: string;
  os_release: string;
  platform: string;
  arch: string;
  hostname: string;
  python_version: string;
  hermes_version: string;
  cpu_count: number | null;
  cpu_percent?: number;
  load_avg?: number[];
  uptime_seconds?: number;
  memory?: { total: number; available: number; used: number; percent: number };
  disk?: { total: number; used: number; free: number; percent: number };
  process?: { pid: number; rss: number; create_time: number; num_threads: number };
}

export const fetchHermesStatus = () => requestJson<HermesStatus>('/api/hx/status');
export const fetchSystemStats = () => requestJson<SystemStats>('/api/hx/system/stats');
export const fetchLogTail = (params: { file: string; lines?: number; level?: string; search?: string }) => {
  const qs = new URLSearchParams({ file: params.file, lines: String(params.lines ?? 200) });
  if (params.level !== undefined && params.level !== 'ALL') qs.set('level', params.level);
  if (params.search !== undefined && params.search.trim() !== '') qs.set('search', params.search.trim());
  return requestJson<{ file: string; lines: string[] }>(`/api/hx/logs?${qs.toString()}`);
};

// --- Webhooks ------------------------------------------------------------------------

export interface WebhookRoute {
  name: string;
  description: string;
  events: string[];
  deliver: string;
  prompt: string;
  skills: string[];
  created_at: string | null;
  url: string;
  enabled: boolean;
}

export const fetchWebhooks = () =>
  requestJson<{ enabled: boolean; base_url: string; subscriptions: WebhookRoute[] }>('/api/hx/webhooks');
export const setWebhookEnabled = (name: string, enabled: boolean) =>
  requestJson<{ ok: boolean }>(`/api/hx/webhooks/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    ...json({ enabled }),
  });

// --- Voice (relay through Hermes; provider keys stay on the server) --------------------

export const transcribeAudio = (dataUrl: string, mimeType: string) =>
  requestJson<{ ok: boolean; transcript: string }>('/api/hx/audio/transcribe', {
    method: 'POST',
    ...json({ data_url: dataUrl, mime_type: mimeType }),
  });
export const speakText = (text: string) =>
  requestJson<{ ok: boolean; data_url: string; mime_type: string }>('/api/hx/audio/speak', {
    method: 'POST',
    ...json({ text }),
  });

// --- Writes added for full management (profiles, skills, cron, MCP, webhooks) ---

export const renameProfile = (name: string, newName: string) =>
  requestJson<{ ok: boolean; name: string; display_name?: string }>(`/api/hx/profiles/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    ...json({ new_name: newName }),
  });
export const setProfileDescription = (name: string, description: string) =>
  requestJson<{ ok: boolean }>(`/api/hx/profiles/${encodeURIComponent(name)}/description`, {
    method: 'PUT',
    ...json({ description }),
  });

export const saveSkillContent = (name: string, content: string) =>
  requestJson<{ success: boolean }>('/api/hx/skills/content', { method: 'PUT', ...json({ name, content }) });
export const createSkill = (name: string, content: string, category?: string) =>
  requestJson<{ success: boolean }>('/api/hx/skills', { method: 'POST', ...json({ name, content, category: category || null }) });
export const deleteSkill = (name: string) =>
  requestJson<{ ok: boolean; message: string }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });

export interface CronJobInput {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  skills?: string[] | null;
  model?: string | null;
  paused?: boolean;
}
export const fetchCronTargets = () =>
  requestJson<{ targets: { id: string; name: string; home_target_set: boolean }[] }>('/api/hx/cron/delivery-targets');
export const createCronJob = (input: CronJobInput) =>
  requestJson<unknown>('/api/hx/cron/jobs', { method: 'POST', ...json(input) });
export const updateCronJob = (id: string, updates: Partial<CronJobInput>) =>
  requestJson<unknown>(`/api/hx/cron/jobs/${encodeURIComponent(id)}`, { method: 'PUT', ...json({ updates }) });

export interface McpServerInput {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: 'none' | 'header' | 'oauth';
  bearer_token?: string;
}
export const addMcpServer = (input: McpServerInput) =>
  requestJson<unknown>('/api/hx/mcp/servers', { method: 'POST', ...json(input) });
export const removeMcpServer = (name: string) =>
  requestJson<unknown>(`/api/hx/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const enableWebhooks = () =>
  requestJson<{ ok: boolean; needs_restart?: boolean }>('/api/hx/webhooks/enable', { method: 'POST', ...json({}) });
export const deleteWebhook = (name: string) =>
  requestJson<unknown>(`/api/hx/webhooks/${encodeURIComponent(name)}`, { method: 'DELETE' });

// --- MEMORY.md / USER.md (server bridge to Hermes' MemoryStore) ---

export type MemoryTarget = 'memory' | 'user';
export interface MemoryFile {
  entries: string[];
  chars: number;
  limit: number;
  enabled: boolean;
}
export const fetchMemoryFile = (target: MemoryTarget) => requestJson<MemoryFile>(`/api/memory-files/${target}`);
export const editMemoryFile = (
  target: MemoryTarget,
  edit: { action: 'add'; content: string } | { action: 'replace'; entry: string; content: string } | { action: 'remove'; entry: string },
) => requestJson<{ ok: boolean; message: string }>(`/api/memory-files/${target}`, { method: 'POST', ...json(edit) });
