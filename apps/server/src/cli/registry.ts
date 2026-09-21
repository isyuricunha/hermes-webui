/**
 * CLI bridge command registry (PRD 35).
 *
 * Every Hermes command reachable through the bridge MUST be declared here.
 * Nothing else executes — there is no free-form shell path (PRD 50.1).
 *
 * Registry policy for RC1: only read-only commands that have NO HTTP API and
 * are useful for daily administration (capability matrix, sections 19-22).
 * Mutating flows are served by the gateway/dashboard APIs; when a mutation
 * genuinely needs the bridge later, it lands here with
 * requiresConfirmation: true and an audit entry.
 */

export interface BridgeCommand {
  id: string;
  displayName: string;
  /** Fixed argv passed to the Hermes binary. Never built from user input. */
  argv: readonly string[];
  readonly readOnly: boolean;
  readonly mutating: boolean;
  readonly requiresConfirmation: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Why this command exists in the registry (audit trail). */
  rationale: string;
}

const MB = 1024 * 1024;

export const BRIDGE_COMMANDS: readonly BridgeCommand[] = [
  {
    id: 'lsp.status',
    displayName: 'LSP status',
    argv: ['lsp', 'status'],
    readOnly: true,
    mutating: false,
    requiresConfirmation: false,
    timeoutMs: 15_000,
    maxOutputBytes: 1 * MB,
    rationale: 'No HTTP surface for LSP (matrix section 19).',
  },
  {
    id: 'lsp.list',
    displayName: 'LSP servers',
    argv: ['lsp', 'list'],
    readOnly: true,
    mutating: false,
    requiresConfirmation: false,
    timeoutMs: 15_000,
    maxOutputBytes: 1 * MB,
    rationale: 'No HTTP surface for LSP (matrix section 19).',
  },
  {
    id: 'gateway.status',
    displayName: 'Gateway status',
    argv: ['gateway', 'status'],
    readOnly: true,
    mutating: false,
    requiresConfirmation: false,
    timeoutMs: 15_000,
    maxOutputBytes: 1 * MB,
    rationale: 'Richer than /health for supervisors and platform detail.',
  },
  {
    id: 'status',
    displayName: 'Hermes status',
    argv: ['status'],
    readOnly: true,
    mutating: false,
    requiresConfirmation: false,
    timeoutMs: 15_000,
    maxOutputBytes: 1 * MB,
    rationale: 'Overview equivalent of the CLI status screen.',
  },
];

export function findBridgeCommand(id: string): BridgeCommand | undefined {
  return BRIDGE_COMMANDS.find((command) => command.id === id);
}

/**
 * Free-form escape hatch allowlist (PRD 36): token sequences the Advanced
 * Hermes CLI page may run, expressed as argv prefixes. Everything else —
 * especially mutating roots — is refused there and must use its dedicated
 * UI or the registry.
 */
export const FREE_FORM_ALLOWED_PREFIXES: readonly (readonly string[])[] = [
  ['lsp', 'status'],
  ['lsp', 'list'],
  ['gateway', 'status'],
  ['status'],
  ['cron', 'list'],
  ['cron', 'status'],
  ['doctor'],
  ['config', 'show'],
  ['skills', 'list'],
  ['mcp', 'list'],
];

export function matchesAllowlist(argv: readonly string[]): boolean {
  // EXACT match only (review F1): prefix matching admitted mutating flags
  // (e.g. `hermes doctor --fix`) through the read-only escape hatch.
  return FREE_FORM_ALLOWED_PREFIXES.some(
    (prefix) =>
      argv.length === prefix.length && prefix.every((token, index) => argv[index] === token),
  );
}
