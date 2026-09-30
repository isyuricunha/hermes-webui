import { execFile } from 'node:child_process';
import os from 'node:os';
import { redact } from '../cli/runner';

/**
 * Write-approval bridge: review the memory/skill writes Hermes staged while
 * `memory.write_approval` / `skills.write_approval` is on.
 *
 * Hermes exposes this only as the `/memory` and `/skills` slash commands
 * (gateway, CLI, TUI); neither the API server nor the dashboard has an HTTP
 * route. So the WebUI runs Hermes' own handler, the same
 * `handle_pending_subcommand` the gateway calls, in Hermes' own Python
 * runtime:
 *
 * - the runtime comes from `hermes --print-runtime-command` (the launcher's
 *   documented way to print its interpreter + source dir), or from
 *   HERMES_PYTHON / HERMES_SOURCE_DIR;
 * - a fixed script, execFile only (no shell), with the subsystem, action and
 *   id as validated argv (never interpolated into code);
 * - sanitized environment, timeout, output cap, credential redaction.
 */

export type ApprovalSubsystem = 'memory' | 'skills';
export type ApprovalAction = 'approve' | 'reject';

export const APPROVAL_SUBSYSTEMS: readonly ApprovalSubsystem[] = ['memory', 'skills'];
export const PENDING_ID = /^(?:all|[A-Za-z0-9_-]{1,64})$/;

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

export interface ApprovalResult {
  ok: boolean;
  message: string;
}

export class WriteApprovalError extends Error {
  constructor(
    readonly code: 'WRITE_APPROVALS_UNAVAILABLE' | 'WRITE_APPROVALS_FAILED',
    message: string,
  ) {
    super(message);
  }
}

interface Runtime {
  python: string;
  source: string;
}

export type ExecFn = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const MARKER = '\u001eHXJSON';

/** Mirrors the launcher's preamble, then calls Hermes' write-approval helpers. */
const SCRIPT = `
import json, os, sys
source, subsystem, command = sys.argv[1], sys.argv[2], sys.argv[3]
target = sys.argv[4] if len(sys.argv) > 4 else ''
for key in ('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV'):
    os.environ.pop(key, None)
sys.path.insert(0, source)
os.environ['HERMES_HOME'] = os.environ.get('HERMES_HOME') or str(__import__('hermes_constants').get_default_hermes_root())
import hermes_bootstrap
from tools import write_approval as wa

def text(value, limit=20000):
    return None if value is None else str(value)[:limit]

if command == 'list':
    items = []
    for record in wa.list_pending(subsystem):
        payload = record.get('payload') or {}
        item = {
            'id': str(record.get('id')),
            'action': record.get('action') or payload.get('action'),
            'summary': text(record.get('summary'), 4000),
            'origin': record.get('origin'),
            'created_at': record.get('created_at'),
        }
        if subsystem == wa.MEMORY:
            ops = (payload.get('operations') or []) if payload.get('action') == 'batch' else [payload]
            item['operations'] = [{
                'action': op.get('action'),
                'target': op.get('target') or payload.get('target'),
                'content': text(op.get('content')),
                'old_text': text(op.get('old_text')),
                'matched_entry': text(op.get('matched_entry')),
            } for op in ops if isinstance(op, dict)]
        else:
            try:
                item['diff'] = text(wa.skill_pending_diff(record), 60000)
            except Exception:
                item['diff'] = None
        items.append(item)
    result = {'enabled': wa.write_approval_enabled(subsystem), 'pending': items}
else:
    from hermes_cli.write_approval_commands import handle_pending_subcommand
    store = None
    if subsystem == wa.MEMORY:
        from tools.memory_tool import load_on_disk_store
        store = load_on_disk_store()
    result = {'message': handle_pending_subcommand(subsystem, [command, target], memory_store=store) or ''}
print('${MARKER}' + json.dumps(result))
`;

const CHILD_ENV = ['PATH', 'HOME', 'LANG', 'USER', 'HERMES_HOME'] as const;

const defaultExec: ExecFn = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of CHILD_ENV) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env, cwd: os.homedir(), windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null;
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
      },
    );
  });

/** Pulls the interpreter and source dir out of `hermes --print-runtime-command`. */
export function parseRuntimeCommand(output: string): Runtime | null {
  let argv: unknown;
  try {
    argv = JSON.parse(output.trim().split('\n').pop() ?? '');
  } catch {
    return null;
  }
  if (!Array.isArray(argv) || typeof argv[0] !== 'string') return null;
  const code = argv.find((item, index) => index > 0 && typeof item === 'string' && item.includes('sys.path.insert'));
  const source = typeof code === 'string' ? /sys\.path\.insert\(0,\s*'([^']+)'\)/.exec(code)?.[1] : undefined;
  return source === undefined ? null : { python: argv[0], source };
}

export class WriteApprovalBridge {
  private runtime: Promise<Runtime> | null = null;
  private readonly exec: ExecFn;

  constructor(
    private readonly options: {
      hermesBin: string;
      python?: string;
      sourceDir?: string;
      exec?: ExecFn;
      timeoutMs?: number;
    },
  ) {
    this.exec = options.exec ?? defaultExec;
  }

  private resolveRuntime(): Promise<Runtime> {
    if (this.options.python !== undefined && this.options.sourceDir !== undefined) {
      return Promise.resolve({ python: this.options.python, source: this.options.sourceDir });
    }
    this.runtime ??= this.exec(this.options.hermesBin, ['--print-runtime-command'], 15_000).then((result) => {
      const runtime = result.code === 0 ? parseRuntimeCommand(result.stdout) : null;
      if (runtime === null) {
        this.runtime = null;
        throw new WriteApprovalError(
          'WRITE_APPROVALS_UNAVAILABLE',
          'Could not locate the Hermes runtime (hermes --print-runtime-command). Set HERMES_PYTHON and HERMES_SOURCE_DIR.',
        );
      }
      return runtime;
    });
    return this.runtime;
  }

  private async run(subsystem: ApprovalSubsystem, command: string, target = ''): Promise<unknown> {
    const runtime = await this.resolveRuntime();
    const args = ['-I', '-c', SCRIPT, runtime.source, subsystem, command];
    if (target !== '') args.push(target);
    const result = await this.exec(runtime.python, args, this.options.timeoutMs ?? 30_000);
    const line = result.stdout.split('\n').find((item) => item.startsWith(MARKER));
    if (result.code !== 0 || line === undefined) {
      const detail = redact(result.stderr.trim().split('\n').slice(-3).join(' ')).text;
      throw new WriteApprovalError(
        'WRITE_APPROVALS_FAILED',
        `Hermes could not ${command === 'list' ? 'list' : command} pending ${subsystem} writes${detail === '' ? '.' : `: ${detail}`}`,
      );
    }
    return JSON.parse(line.slice(MARKER.length)) as unknown;
  }

  async list(subsystem: ApprovalSubsystem): Promise<PendingList> {
    const data = (await this.run(subsystem, 'list')) as Partial<PendingList>;
    return { enabled: data.enabled === true, pending: Array.isArray(data.pending) ? data.pending : [] };
  }

  async resolve(subsystem: ApprovalSubsystem, action: ApprovalAction, id: string): Promise<ApprovalResult> {
    if (!PENDING_ID.test(id)) {
      throw new WriteApprovalError('WRITE_APPROVALS_FAILED', 'Invalid pending write id.');
    }
    const data = (await this.run(subsystem, action, id)) as { message?: unknown };
    const message = redact(typeof data.message === 'string' ? data.message : '').text;
    const ok = message !== '' && !/^(No pending|Usage)/.test(message) && !/\nFailed:/.test(message);
    return { ok, message };
  }
}
