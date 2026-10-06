/**
 * Numeric bounds for Guided Config.
 *
 * The Hermes dashboard schema exposes type/description/options but not min/max.
 * These ranges are curated from Hermes docs and upstream clamps so the guided
 * editor can show and enforce sensible limits without inventing false precision.
 *
 * Sources (Hermes Agent docs / upstream, 2026-10):
 * - https://hermes-agent.nousresearch.com/docs/user-guide/configuration
 * - website/docs/developer-guide/context-compression-and-caching.md
 * - delegation.max_spawn_depth clamp 1–3; max_concurrent_children floor 1
 * - vision.embed_target_bytes clamp 64 KiB..4 MiB
 * - plugins.clone_timeout_seconds default 300, clamp ≤ 3600
 *
 * Only paths listed here get hard bounds in the guided editor. Everything else
 * stays free-form (still type-checked as number).
 */

export interface ConfigBound {
  /** Inclusive lower bound. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
  /** Prefer whole numbers in the UI and server check. */
  integer?: boolean;
  /** Short human note shown under the control (i18n key optional later). */
  note?: string;
}

/**
 * Exact path → bound. Prefer this over heuristics so we only constrain what we
 * actually verified in Hermes docs/source.
 */
export const CONFIG_BOUNDS: Readonly<Record<string, ConfigBound>> = {
  // Agent loop
  'agent.max_turns': { min: 1, max: 500, integer: true, note: 'Tool-calling iterations per turn (default ~60–90).' },
  'agent.api_max_retries': { min: 0, max: 20, integer: true },
  'agent.max_verify_nudges': { min: 0, max: 20, integer: true },

  // Delegation (docs: max_spawn_depth 1–3; concurrent children floor 1)
  'delegation.max_spawn_depth': { min: 1, max: 3, integer: true, note: 'Hermes clamps depth to 1–3.' },
  'delegation.max_concurrent_children': { min: 1, max: 32, integer: true, note: 'Hermes floor is 1.' },
  'delegation.max_iterations': { min: 1, max: 500, integer: true },
  'delegation.child_timeout_seconds': { min: 1, max: 86_400, integer: true },
  'delegation.max_summary_chars': { min: 100, max: 200_000, integer: true },
  'delegation.oneshot_max_children': { min: 1, max: 32, integer: true },

  // Compression
  'compression.threshold': { min: 0.05, max: 0.99, note: 'Fraction of context that triggers compression.' },
  'compression.target_ratio': { min: 0.1, max: 0.8, note: 'Hermes documents 0.10–0.80 for legacy tail mode.' },
  'compression.protect_last_n': { min: 1, max: 500, integer: true },
  'compression.protect_first_n': { min: 0, max: 500, integer: true },
  'compression.min_tail_user_messages': { min: 1, max: 50, integer: true },
  'compression.max_attempts': { min: 1, max: 20, integer: true },
  'compression.threshold_tokens': { min: 1000, max: 2_000_000, integer: true },

  // Checkpoints
  'checkpoints.max_snapshots': { min: 1, max: 200, integer: true },
  'checkpoints.retention_days': { min: 1, max: 365, integer: true },
  'checkpoints.max_file_size_mb': { min: 1, max: 10_000, integer: true },
  'checkpoints.max_total_size_mb': { min: 1, max: 100_000, integer: true },
  'checkpoints.min_interval_hours': { min: 0, max: 168 },

  // Memory / context files
  'memory.memory_char_limit': { min: 200, max: 50_000, integer: true },
  'memory.user_char_limit': { min: 200, max: 50_000, integer: true },
  'file_read_max_chars': { min: 1000, max: 2_000_000, integer: true },
  'context_file_read_timeout': { min: 1, max: 120, integer: true },
  context_file_max_chars: { min: 1000, max: 500_000, integer: true, note: 'Docs: floor ~20k dynamic, ceiling 500k.' },

  // Tool output
  'tool_output.max_bytes': { min: 1000, max: 5_000_000, integer: true },
  'tool_output.max_lines': { min: 10, max: 100_000, integer: true },
  'tool_output.max_line_length': { min: 40, max: 100_000, integer: true },

  // Terminal / code execution
  'terminal.timeout': { min: 1, max: 86_400, integer: true, note: 'Per-command timeout (seconds).' },
  'code_execution.timeout': { min: 1, max: 86_400, integer: true },
  'code_execution.max_tool_calls': { min: 1, max: 500, integer: true },

  // Browser
  'browser.command_timeout': { min: 1, max: 600, integer: true },
  'browser.inactivity_timeout': { min: 1, max: 86_400, integer: true },
  'browser.dialog_timeout_s': { min: 1, max: 600, integer: true },

  // Vision (docs: embed_target_bytes clamped 64 KiB..4 MiB)
  'vision.embed_target_bytes': {
    min: 65_536,
    max: 4_194_304,
    integer: true,
    note: 'Hermes clamps to 64 KiB–4 MiB.',
  },
  'vision.max_calls_per_image': { min: 0, max: 100, integer: true },

  // Human delay
  'human_delay.min_ms': { min: 0, max: 60_000, integer: true },
  'human_delay.max_ms': { min: 0, max: 120_000, integer: true },

  // TTS
  'tts.speed': { min: 0.25, max: 4, note: 'Global speed multiplier.' },

  // Approvals
  'approvals.timeout': { min: 1, max: 86_400, integer: true },

  // Runtime
  'runtime.nofile_soft_limit': { min: 0, max: 1_048_576, integer: true, note: '0 disables the adjustment.' },

  // Plugins
  'plugins.clone_timeout_seconds': {
    min: 30,
    max: 3600,
    integer: true,
    note: 'Hermes clamps values above 3600.',
  },

  // Sessions / retention
  'sessions.retention_days': { min: 1, max: 3650, integer: true },

  // Model context override (0 = auto)
  model_context_length: { min: 0, max: 2_000_000, integer: true, note: '0 = auto-detect from model metadata.' },
} as const;

export function getConfigBound(path: string): ConfigBound | undefined {
  return CONFIG_BOUNDS[path];
}

/** Returns an error message when value is outside the curated bound, else null. */
export function checkConfigBound(path: string, value: number): string | null {
  const bound = CONFIG_BOUNDS[path];
  if (bound === undefined) return null;
  if (!Number.isFinite(value)) return 'expects a finite number';
  if (bound.integer === true && !Number.isInteger(value)) return 'expects a whole number';
  if (bound.min !== undefined && value < bound.min) return `must be ≥ ${bound.min}`;
  if (bound.max !== undefined && value > bound.max) return `must be ≤ ${bound.max}`;
  return null;
}
