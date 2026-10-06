/**
 * Config safety rules shared by the server (which enforces them) and the web
 * app (which only displays them). The guided config editor lets anyone change
 * Hermes settings without touching YAML, so the question "which keys are safe
 * to edit this way?" has exactly one answer, defined here.
 *
 * Tiers:
 * - free:    plain scalar settings (limits, display, timeouts...). Edited directly.
 * - confirm: settings that change which model answers, where messages go, what
 *            the agent may run or who may reach it. Editable after an explicit
 *            confirmation.
 * - locked:  anything that can lock you out, leak a secret or break Hermes
 *            itself (credentials, providers, plugin lists, MCP servers,
 *            auto-generated bookkeeping). Raw config only.
 */

export type ConfigTier = 'free' | 'confirm' | 'locked';

/** Path prefixes that are never edited through the guided editor. A prefix
 *  ending in "_" matches by plain startsWith (known_*); the rest match the
 *  path itself or anything below it. */
const LOCKED_PREFIXES = [
  '_config_version',
  'known_',
  'dashboard.basic_auth',
  'dashboard.auth',
  'command_allowlist',
  'providers',
  'fallback_providers',
  'fallback_model',
  'credential_pool_strategies',
  'model_aliases',
  'mcp_servers',
  'platform_toolsets',
  'plugins',
  'onboarding',
  'nous',
] as const;

/** Path prefixes that need an explicit confirmation before they change. */
const CONFIRM_PREFIXES = [
  'model',
  'model_context_length',
  'delegation',
  'auxiliary',
  'moa',
  'platforms',
  'gateway',
  'telegram',
  'discord',
  'security',
  'approvals',
  'terminal',
  'browser',
  'memory',
  'kanban',
  'lsp',
  'code_execution',
  'cron',
  'updates',
  'web',
  'smart_model_routing',
  'dashboard',
  'agent.reasoning',
  'skills.write_approval',
] as const;

/** Any path segment that names a credential. Whole words only: `max_tokens`
 *  is a limit, `bot_token` is a secret. */
const SECRET_SEGMENT =
  /(^|_)(password|passwd|secret|token|api_?key|credentials?|private_?key|hash|key_env)(_|$)/i;

function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix.endsWith('_')) {
    return path.startsWith(prefix);
  }
  return path === prefix || path.startsWith(`${prefix}.`);
}

/** True when the path looks like it holds a credential (its value is never sent to the browser). */
export function isSecretLikePath(path: string): boolean {
  return path.split('.').some((segment) => SECRET_SEGMENT.test(segment));
}

export function classifyConfigPath(path: string): ConfigTier {
  if (isSecretLikePath(path) || LOCKED_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return 'locked';
  }
  if (CONFIRM_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return 'confirm';
  }
  return 'free';
}

/** Schema types the guided editor can write. Lists and maps stay in Raw config. */
export const GUIDED_EDITABLE_TYPES = ['string', 'number', 'boolean', 'select'] as const;

export function isGuidedEditableType(type: string): boolean {
  return (GUIDED_EDITABLE_TYPES as readonly string[]).includes(type);
}

// -- Wire types -----------------------------------------------------------------

export interface ConfigValidationIssue {
  line: number;
  message: string;
}

export interface ConfigValidationError extends ConfigValidationIssue {
  column: number;
}

export interface ConfigValidationWarning extends ConfigValidationIssue {
  /** Dotted config path the warning is about ('' when it is about the file). */
  path: string;
}

/** Result of checking a config.yaml text before it is saved. */
export interface ConfigValidation {
  /** False when the text cannot be saved (syntax errors, wrong top level). */
  ok: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

export interface GuidedConfigRow {
  path: string;
  type: string;
  /** Human label (the schema description). */
  description: string;
  category: string;
  tier: ConfigTier;
  /** False for locked tiers and for types the guided editor cannot write. */
  editable: boolean;
  options?: string[];
  searchable?: boolean;
  clearable?: boolean;
  /** Effective value (config.yaml over defaults). null when masked. */
  value: string | number | boolean | null;
  /** True when the value is withheld because the key looks like a credential. */
  masked: boolean;
  defaultValue: string | number | boolean | null;
  /** True when config.yaml sets this key explicitly (it can be restored to default). */
  isSet: boolean;
}

export interface GuidedConfigState {
  rows: GuidedConfigRow[];
  categoryOrder: string[];
  /** Absolute path of the config file. */
  path: string;
  /** Revision of the file this state was read from; send it back with writes. */
  rev: string;
  /** Lists and maps the schema knows about but the guided editor does not show. */
  hiddenCount: number;
}

export type GuidedConfigOp =
  | { op: 'set'; path: string; value: string | number | boolean; confirm?: boolean }
  | { op: 'unset'; path: string; confirm?: boolean };

export interface GuidedConfigResult {
  ok: boolean;
  applied: { op: 'set' | 'unset'; path: string }[];
  /** Ops that needed no change (an unset of a key that was not in the file). */
  skipped: { op: 'set' | 'unset'; path: string; reason: string }[];
  /** True when a re-read of Hermes' config confirms every applied change landed. */
  verified: boolean;
  mismatches: string[];
  rev: string;
}
