import { execFile } from 'node:child_process';

/**
 * CLI bridge runner (PRD 34, 50): executes the Hermes binary with execFile
 * semantics — never a shell. Security controls applied here:
 *
 * - fixed argv arrays only (no string concatenation into a shell)
 * - timeout with child kill
 * - output capped (maxBuffer) and reported as truncated
 * - conservative redaction of credential-shaped strings in output
 * - sanitized child environment (PATH/HOME only what the binary needs)
 * - no sudo, runs as the WebUI process user
 */

export interface RunnerOptions {
  /** Path or name of the Hermes binary. Defaults to `hermes` on PATH. */
  hermesBin: string;
  fetchImpl?: never;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  redacted: boolean;
}

/** Credential-shaped values are scrubbed from bridge output (PRD 50.8). */
const REDACTION_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+\S+/gi,
  /\b(?:api[_-]?key|token|password|secret)\s*[=:]\s*\S+/gi,
];

export function redact(output: string): { text: string; redacted: boolean } {
  let redacted = false;
  let text = output;
  for (const pattern of REDACTION_PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return '[REDACTED]';
    });
  }
  return { text, redacted };
}

const CHILD_ENV = ['PATH', 'HOME', 'LANG', 'TERM', 'USER', 'SHELL'] as const;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key] as string;
    }
  }
  return env;
}

export function runHermesArgv(
  options: RunnerOptions,
  argv: readonly string[],
): Promise<BridgeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      options.hermesBin,
      [...argv],
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        env: childEnv(),
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const truncated =
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          String((error as NodeJS.ErrnoException).code).includes('MAXBUFFER');
        const exitCode =
          error !== null && typeof error === 'object' && 'code' in error
            ? typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code as number)
              : null
            : 0;
        const out = redact(String(stdout ?? ''));
        const err = redact(String(stderr ?? ''));
        resolve({
          stdout: out.text,
          stderr: err.text,
          exitCode: error === null ? 0 : exitCode,
          durationMs: Date.now() - started,
          truncated,
          redacted: out.redacted || err.redacted,
        });
      },
    );
  });
}

/**
 * Tokenizes a free-form command line conservatively for the Advanced Hermes
 * CLI escape hatch (PRD 36.1): whitespace splitting only, and any shell
 * operator or substitution character is rejected outright.
 */
export function tokenizeCommandLine(input: string): { tokens: string[]; error?: string } {
  const forbidden = /[;|&<>()$`]|\|\||&&/;
  if (forbidden.test(input)) {
    return { tokens: [], error: 'Shell operators are not allowed.' };
  }
  const tokens = input.trim().split(/\s+/).filter((token) => token !== '');
  return { tokens };
}
