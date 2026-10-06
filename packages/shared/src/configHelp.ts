/**
 * Human labels and help text for Guided Config rows.
 *
 * Hermes' dashboard schema mostly ships auto titles like
 * "Agent → Max Turns" (834/881 fields). Those are not explanations.
 * We:
 * 1. Build a clean title from the path's last segment
 * 2. Prefer a curated help string when we know what the setting does
 * 3. Fall back to the schema description only when it looks hand-written
 */

import { getConfigBound } from './configBounds';

/** Title Case from a dotted path's last segment: agent.max_turns → Max Turns */
export function titleFromConfigPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** True when the schema description is just a humanized path, not real help. */
export function isAutoSchemaDescription(description: string, path: string): boolean {
  const trimmed = description.trim();
  if (!trimmed) return true;
  if (trimmed.includes('→') || trimmed.includes('->')) return true;
  const leafTitle = titleFromConfigPath(path);
  if (trimmed.toLowerCase() === leafTitle.toLowerCase()) return true;
  // "Context File Max Chars" vs path context_file_max_chars
  const collapsed = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (collapsed(trimmed) === collapsed(path) || collapsed(trimmed) === collapsed(leafTitle)) return true;
  return false;
}

/**
 * Curated explanations for settings operators actually touch.
 * Keep entries short (one or two sentences). Prefer Hermes docs wording.
 */
export const CONFIG_HELP: Readonly<Record<string, string>> = {
  // General
  model: 'Default model id for new turns (provider/model). Can be overridden per session or CLI.',
  model_context_length:
    'Override the model context window in tokens. 0 means auto-detect from model metadata.',
  context_file_max_chars:
    'Max characters loaded from project context files (AGENTS.md, HERMES.md, etc.) before head/tail truncation. Unset uses a dynamic limit from the model window (about 20k–500k).',
  context_file_read_timeout:
    'Seconds to wait when reading a context file (slow network drives). Timed-out files are skipped with a warning.',
  file_read_max_chars:
    'Max characters the file_read tool returns in one call before truncation (~25–35k tokens at the default).',

  // Agent
  'agent.max_turns':
    'Maximum tool-calling iterations in one agent turn. Higher allows longer autonomous work but costs more tokens.',
  'agent.api_max_retries': 'How many times to retry a failed provider API call before giving up.',
  'agent.verbose': 'Enable verbose agent logging for debugging.',
  'agent.reasoning_effort':
    'How much “thinking” the model does before answering (none → max). Empty uses the provider default (usually medium).',

  // Terminal
  'terminal.backend': 'Where shell commands run: local, docker, ssh, or a cloud sandbox backend.',
  'terminal.timeout': 'Per-command timeout in seconds for terminal tool runs.',
  'terminal.cwd': 'Working directory for gateway/cron terminal sessions (CLI still uses the launch directory).',

  // Display
  'display.skin': 'CLI / dashboard visual theme.',
  'display.nickname': 'Display name shown for this Hermes profile.',

  // Delegation
  'delegation.max_spawn_depth':
    'How deep the sub-agent tree may go (Hermes clamps to 1–3). 1 = flat leaves only; 2–3 allow orchestrator children.',
  'delegation.max_concurrent_children': 'How many child agents may run in parallel in one batch (minimum 1).',
  'delegation.max_iterations': 'Max tool iterations allowed inside each delegated child agent.',
  'delegation.child_timeout_seconds': 'Wall-clock timeout for a single child agent run.',
  'delegation.max_summary_chars': 'Max size of the summary a child returns to the parent.',

  // Memory
  'memory.memory_enabled': 'Enable persistent agent memory (MEMORY.md / notes).',
  'memory.user_profile_enabled': 'Enable the user profile memory file (USER.md).',
  'memory.memory_char_limit': 'Max characters stored in agent memory (~token budget for MEMORY.md).',
  'memory.user_char_limit': 'Max characters stored in the user profile memory file.',

  // Compression
  'compression.threshold':
    'Fraction of the context window that triggers compression (e.g. 0.8 ≈ when ~80% full).',
  'compression.target_ratio':
    'How much of the threshold budget to keep as a verbatim tail in legacy mode (docs: about 0.10–0.80).',
  'compression.protect_last_n': 'Minimum number of recent messages always kept uncompressed.',
  'compression.min_tail_user_messages':
    'Minimum number of real user messages kept in the uncompressed tail.',
  'compression.threshold_tokens': 'Absolute token trigger for compression when set (overrides pure ratio mode).',

  // Security / approvals
  'approvals.mode':
    'How dangerous terminal commands are handled: smart (LLM review), manual (always ask), or off (no checks — sandbox only).',
  'approvals.timeout': 'Seconds to wait for a human approval before the pending command fails.',

  // Browser
  'browser.command_timeout': 'Timeout in seconds for a single browser automation command.',
  'browser.inactivity_timeout': 'Close the browser session after this many seconds idle.',
  'browser.dialog_timeout_s': 'Seconds to wait for a browser dialog (alert/confirm) before continuing.',

  // Tool output
  'tool_output.max_bytes': 'Max characters of terminal stdout/stderr kept before head/tail truncation.',
  'tool_output.max_lines': 'Max lines a single read_file tool call may return.',
  'tool_output.max_line_length': 'Max characters shown per line in numbered file views.',

  // Code execution
  'code_execution.mode': 'execute_code tool mode: project (default workspace) or strict isolation.',
  'code_execution.timeout': 'Max runtime in seconds for code_execution tool runs.',
  'code_execution.max_tool_calls': 'Max nested tool calls allowed inside one code_execution session.',

  // Checkpoints
  'checkpoints.enabled': 'Take filesystem snapshots before destructive file operations.',
  'checkpoints.max_snapshots': 'How many checkpoint snapshots to keep per directory.',
  'checkpoints.retention_days': 'Delete checkpoints older than this many days.',

  // Vision / TTS / human delay
  'vision.embed_target_bytes':
    'Target size in bytes when embedding images into context (Hermes clamps to 64 KiB–4 MiB).',
  'vision.max_calls_per_image':
    'Max times the same image may be re-embedded in a session (0 = unlimited on the main agent).',
  'tts.speed': 'Global speech rate multiplier for text-to-speech.',
  'tts.provider': 'Text-to-speech provider (edge, openai, elevenlabs, …).',
  'stt.language': 'Preferred language code for speech-to-text.',
  'human_delay.mode': 'Simulate human typing delay on messaging platforms: off, natural, or custom.',
  'human_delay.min_ms': 'Minimum delay in milliseconds when human_delay.mode is custom.',
  'human_delay.max_ms': 'Maximum delay in milliseconds when human_delay.mode is custom.',

  // Runtime / plugins / sessions
  'runtime.nofile_soft_limit':
    'Soft RLIMIT_NOFILE for long-running Hermes processes. 0 disables the adjustment.',
  'plugins.clone_timeout_seconds':
    'Timeout for git clone/fetch when installing plugins (Hermes clamps above 3600s).',
  'sessions.retention_days': 'How many days to keep session data before cleanup.',
} as const;

export function getConfigHelp(path: string, schemaDescription?: string): string | undefined {
  const curated = CONFIG_HELP[path];
  if (curated) return curated;

  if (schemaDescription && !isAutoSchemaDescription(schemaDescription, path)) {
    return schemaDescription.trim();
  }

  const bound = getConfigBound(path);
  if (bound?.note) return bound.note;

  return undefined;
}

export function getConfigTitle(path: string, schemaDescription?: string): string {
  // Prefer a short hand-written schema title when it is not the arrow auto form
  // and not an example-style prompt ("Default model (e.g. …)").
  if (schemaDescription && !isAutoSchemaDescription(schemaDescription, path)) {
    const trimmed = schemaDescription.trim();
    const looksLikeExample = /\be\.g\.\b|\beg\b|\(/i.test(trimmed);
    if (!looksLikeExample && trimmed.length <= 48 && !trimmed.endsWith('.')) {
      return trimmed;
    }
  }
  return titleFromConfigPath(path);
}
