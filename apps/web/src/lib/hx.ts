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

// --- Messaging channels ------------------------------------------------------------------

export interface MessagingEnvVar {
  key: string;
  required: boolean;
  is_set: boolean;
  /** Short masked preview of a saved value ("abc…xyz"), never the value. */
  redacted_value: string | null;
  description: string;
  prompt: string;
  help: string;
  url: string | null;
  is_password: boolean;
  advanced: boolean;
}

export interface MessagingPlatform {
  id: string;
  name: string;
  description: string;
  docs_url: string | null;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  state: string | null;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
  home_channel: { platform?: string; chat_id?: string; name?: string } | null;
  env_vars: MessagingEnvVar[];
  ingress_url: string | null;
  /** Adapter plugin behind the channel; off means the gateway never loads it. */
  plugin?: { name: string; enabled: boolean } | null;
}

export interface MessagingPlatformsResponse {
  env_path?: string;
  gateway_start_command?: string;
  platforms: MessagingPlatform[];
}

export const fetchMessaging = () => requestJson<MessagingPlatformsResponse>('/api/settings/messaging/platforms');
export const updateMessagingPlatform = (
  id: string,
  body: { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] },
) =>
  requestJson<{ ok: boolean; platform: string }>(`/api/hx/messaging/platforms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...json({ env: {}, clear_env: [], ...body }),
  });
export const testMessagingPlatform = (id: string) =>
  requestJson<{ ok: boolean; state: string | null; message: string }>(
    `/api/hx/messaging/platforms/${encodeURIComponent(id)}/test`,
    { method: 'POST', ...json({}) },
  );

export interface RestartResult {
  ok: boolean;
  needs_restart?: boolean;
  restart_started?: boolean;
  restart_error?: string;
}

export const startTelegramSetup = (botName: string) =>
  requestJson<{ pairing_id: string; suggested_username: string; deep_link: string; qr_payload: string; expires_at: string }>(
    '/api/hx/messaging/telegram/onboarding/start',
    { method: 'POST', ...json({ bot_name: botName }) },
  );
export const pollTelegramSetup = (pairingId: string) =>
  requestJson<{ status: 'waiting' | 'ready'; bot_username?: string | null; owner_user_id?: string | null; expires_at: string }>(
    `/api/hx/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`,
  );
export const applyTelegramSetup = (pairingId: string, allowedUserIds: string[]) =>
  requestJson<RestartResult & { bot_username?: string | null }>(
    `/api/hx/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`,
    { method: 'POST', ...json({ allowed_user_ids: allowedUserIds }) },
  );
export const cancelTelegramSetup = (pairingId: string) =>
  requestJson<{ ok: boolean }>(`/api/hx/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`, {
    method: 'DELETE',
  });

export interface WhatsAppSetup {
  pairing_id: string;
  status: 'installing' | 'starting' | 'waiting' | 'connected' | 'error' | 'expired' | 'cancelled';
  qr_payload: string | null;
  expires_at: string;
  mode: 'bot' | 'self-chat';
  allowed_users: string;
  account_id: string | null;
  account_name: string | null;
  account_phone: string | null;
  error: string | null;
}

export const startWhatsAppSetup = (mode: 'bot' | 'self-chat', allowedUsers: string) =>
  requestJson<WhatsAppSetup>('/api/hx/messaging/whatsapp/onboarding/start', {
    method: 'POST',
    ...json({ mode, allowed_users: allowedUsers }),
  });
export const pollWhatsAppSetup = (pairingId: string) =>
  requestJson<WhatsAppSetup>(`/api/hx/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`);
export const applyWhatsAppSetup = (pairingId: string, body: { mode?: string; allowed_users?: string }) =>
  requestJson<RestartResult>(`/api/hx/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`, {
    method: 'POST',
    ...json(body),
  });
export const cancelWhatsAppSetup = (pairingId: string) =>
  requestJson<{ ok: boolean }>(`/api/hx/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`, {
    method: 'DELETE',
  });

// --- Pairing (access requests from people who messaged a bot) ----------------------------

export interface PairingPending {
  platform: string;
  request_id: string;
  user_id: string;
  user_name: string;
  age_minutes: number;
}
export interface PairingApproved {
  platform: string;
  user_id: string;
  user_name?: string;
  approved_at?: number;
}

export const fetchPairing = () =>
  requestJson<{ pending: PairingPending[]; approved: PairingApproved[] }>('/api/hx/pairing');
export const approvePairing = (platform: string, target: { request_id?: string; code?: string }) =>
  requestJson<{ ok: boolean }>('/api/hx/pairing/approve', { method: 'POST', ...json({ platform, ...target }) });
export const revokePairing = (platform: string, userId: string) =>
  requestJson<{ ok: boolean }>('/api/hx/pairing/revoke', { method: 'POST', ...json({ platform, user_id: userId }) });
export const clearPendingPairing = () =>
  requestJson<{ ok: boolean; cleared: number }>('/api/hx/pairing/clear-pending', { method: 'POST', ...json({}) });

// --- Webhook create, profiles create/delete, gateway start, curator run ---------------------

export interface WebhookInput {
  name: string;
  description?: string;
  events: string[];
  prompt?: string;
  skills: string[];
  deliver: string;
  deliver_only: boolean;
  deliver_chat_id?: string;
}
export const createWebhook = (input: WebhookInput) =>
  requestJson<WebhookRoute & { secret: string }>('/api/hx/webhooks', { method: 'POST', ...json(input) });

export const createProfile = (input: {
  name: string;
  description?: string;
  clone_from?: string;
  clone_all?: boolean;
}) => requestJson<{ ok: boolean; name?: string; path?: string }>('/api/hx/profiles', { method: 'POST', ...json(input) });
export const deleteProfile = (name: string) =>
  requestJson<{ ok: boolean; settlement_pending?: boolean; retry_command?: string }>(
    `/api/hx/profiles/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );

export const startGateway = () => requestJson<{ ok: boolean }>('/api/hx/gateway/start', { method: 'POST', ...json({}) });
/** The curator rewrites skills, so Hermes wants the profile named when it serves several. */
export const runCurator = (profile: string) =>
  requestJson<{ ok: boolean; message?: string }>(`/api/hx/curator/run?profile=${encodeURIComponent(profile)}`, {
    method: 'POST',
    ...json({}),
  });

// --- Toolset setup (provider, keys, model) ------------------------------------------------

export interface ToolsetProviderRow {
  name: string;
  badge: string;
  tag: string;
  env_vars: { key: string; prompt: string; url: string | null; default: string | null; is_set: boolean }[];
  post_setup: string | null;
  requires_nous_auth: boolean;
  is_active: boolean;
  status: string;
  web_backend?: string;
  capabilities?: string[];
}
export interface ToolsetConfig {
  name: string;
  has_category: boolean;
  providers: ToolsetProviderRow[];
  active_provider: string | null;
  active_search_backend?: string | null;
  active_extract_backend?: string | null;
}
export interface ToolsetModels {
  name: string;
  has_models: boolean;
  provider?: string;
  models: { id: string; display: string; speed: string; strengths: string; price: string }[];
  current: string | null;
  default: string | null;
}

const toolsetPath = (name: string) => `/api/hx/tools/toolsets/${encodeURIComponent(name)}`;
export const fetchToolsetConfig = (name: string) => requestJson<ToolsetConfig>(`${toolsetPath(name)}/config`);
export const selectToolsetProvider = (name: string, provider: string, capability?: 'search' | 'extract') =>
  requestJson<{ ok: boolean }>(`${toolsetPath(name)}/provider`, {
    method: 'PUT',
    ...json(capability === undefined ? { provider } : { provider, capability }),
  });
export const saveToolsetEnv = (name: string, env: Record<string, string>) =>
  requestJson<{ ok: boolean; saved: string[] }>(`${toolsetPath(name)}/env`, { method: 'PUT', ...json({ env }) });
export const fetchToolsetModels = (name: string) => requestJson<ToolsetModels>(`${toolsetPath(name)}/models`);
export const selectToolsetModel = (name: string, model: string) =>
  requestJson<{ ok: boolean }>(`${toolsetPath(name)}/model`, { method: 'PUT', ...json({ model }) });

// --- Memory providers (switch, configure, install) -------------------------------------------

export interface SchemaField {
  key: string;
  label: string;
  kind: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  value?: string | boolean | number | null;
  is_set?: boolean;
  options?: { value: string; label: string; description?: string }[];
  url?: string;
  when?: Record<string, unknown> | null;
}
export interface MemoryProviderConfig {
  name: string;
  label: string;
  fields: SchemaField[];
  setup?: {
    pip_dependencies: string[];
    external_dependencies: { name: string; install: string; check: string }[];
    required_env: string[];
    dependencies_installed: boolean;
  };
}
export interface SetupResult {
  ok: boolean;
  results: { kind: string; name: string; status: string; command: string; stdout: string; stderr: string }[];
}

export const setMemoryProvider = (provider: string) =>
  requestJson<{ ok: boolean; active: string }>('/api/hx/memory/provider', { method: 'PUT', ...json({ provider }) });
export const fetchMemoryProviderConfig = (name: string) =>
  requestJson<MemoryProviderConfig>(`/api/hx/memory/providers/${encodeURIComponent(name)}/config`);
export const saveMemoryProviderConfig = (name: string, values: Record<string, unknown>) =>
  requestJson<{ ok: boolean; active?: string }>(`/api/hx/memory/providers/${encodeURIComponent(name)}/config`, {
    method: 'PUT',
    ...json({ values }),
  });
export const setupMemoryProvider = (name: string, values: Record<string, unknown>) =>
  requestJson<SetupResult>(`/api/hx/memory/providers/${encodeURIComponent(name)}/setup`, {
    method: 'POST',
    ...json({ values }),
  });

export const setAgentPluginEnabled = (name: string, enabled: boolean) =>
  requestJson<{ ok: boolean; restart_required?: boolean; unchanged?: boolean }>(
    `/api/hx/dashboard/agent-plugins/${encodeURIComponent(name)}/${enabled ? 'enable' : 'disable'}`,
    { method: 'POST', ...json({}) },
  );
