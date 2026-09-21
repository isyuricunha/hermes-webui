import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_COMMANDS, matchesAllowlist } from '../src/cli/registry';
import { redact, runHermesArgv, tokenizeCommandLine } from '../src/cli/runner';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

function makeStubBinary(script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hwui-cli-'));
  const bin = path.join(dir, 'hermes-stub');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

describe('cli bridge registry', () => {
  it('has unique command ids and typed argv arrays', () => {
    const ids = BRIDGE_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of BRIDGE_COMMANDS) {
      expect(command.argv.length).toBeGreaterThan(0);
      expect(typeof command.timeoutMs).toBe('number');
      expect(command.maxOutputBytes).toBeGreaterThan(0);
    }
  });

  it('requires confirmation for every mutating command', () => {
    for (const command of BRIDGE_COMMANDS) {
      if (command.mutating) {
        expect(command.requiresConfirmation).toBe(true);
      }
    }
  });

  it('free-form allowlist never includes mutating roots', () => {
    for (const prefix of [['update'], ['gateway', 'restart'], ['gateway', 'stop'], ['config', 'set']]) {
      expect(matchesAllowlist(prefix)).toBe(false);
    }
    expect(matchesAllowlist(['lsp', 'status'])).toBe(true);
    expect(matchesAllowlist(['status'])).toBe(true);
    expect(matchesAllowlist(['update'])).toBe(false);
  });

  it('exact-arity matching refuses extra flags on allowlisted commands (review F1)', () => {
    // `hermes doctor --fix` is mutating (attempt auto-fixes); prefix matching
    // used to admit it through the read-only escape hatch.
    expect(matchesAllowlist(['doctor', '--fix'])).toBe(false);
    expect(matchesAllowlist(['doctor', '--ack', 'x'])).toBe(false);
    expect(matchesAllowlist(['lsp', 'status', '--json'])).toBe(false);
  });
});

describe('runner security helpers', () => {
  it('redacts credential-shaped output', () => {
    const { text, redacted } = redact(
      'key is sk-abcdef1234567890 and Authorization: Bearer abc.def ' +
        'aws AKIAIOSFODNN7EXAMPLE stripe sk_live_51H8xYz1234567890123 ' +
        'pat github_pat_11ABCDEF0123456789012345 gitlab glpat-AbCdEf123456 ' +
        'google AIzaSyA1234567890abcdefghijklmnopqrstuv',
    );
    expect(redacted).toBe(true);
    expect(text).not.toContain('sk-abcdef1234567890');
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).not.toContain('sk_live_51H8xYz1234567890123');
    expect(text).not.toContain('github_pat_11ABCDEF0123456789012345');
    expect(text).not.toContain('glpat-AbCdEf123456');
    expect(text).not.toContain('AIzaSyA1234567890');
    expect(text).toContain('[REDACTED]');
  });

  it('rejects shell operators in the free-form tokenizer', () => {
    expect(tokenizeCommandLine('hermes lsp status; rm -rf /').error).toBeDefined();
    expect(tokenizeCommandLine('hermes status && hermes update').error).toBeDefined();
    expect(tokenizeCommandLine('hermes doctor $(whoami)').error).toBeDefined();
    expect(tokenizeCommandLine('hermes lsp status').tokens).toEqual(['hermes', 'lsp', 'status']);
  });
});

describe('bridge execution against a stub binary', () => {
  it('executes argv without a shell and redacts credential output', async () => {
    const bin = makeStubBinary('#!/bin/sh\necho "ran with args: $*"\necho "leak sk-12345678abcdefgh"\n');
    const result = await runHermesArgv({ hermesBin: bin, timeoutMs: 5000, maxOutputBytes: 1024 * 1024 }, [
      'lsp',
      'status',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ran with args: lsp status');
    expect(result.redacted).toBe(true);
    expect(result.stdout).not.toContain('sk-12345678abcdefgh');
  });

  it('caps output and reports truncation', async () => {
    const bin = makeStubBinary('#!/bin/sh\nyes "padding line" | head -c 200000\n');
    const result = await runHermesArgv({ hermesBin: bin, timeoutMs: 5000, maxOutputBytes: 1024 }, [
      'status',
    ]);
    expect(result.truncated).toBe(true);
  });

  it('reports nonzero exit codes from the stub', async () => {
    const bin = makeStubBinary('#!/bin/sh\necho "boom" >&2\nexit 3\n');
    const result = await runHermesArgv({ hermesBin: bin, timeoutMs: 5000, maxOutputBytes: 65536 }, [
      'status',
    ]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
  });
});

describe('cli bridge routes', () => {
  it('executes a registry command and enforces the free-form allowlist', async () => {
    const bin = makeStubBinary('#!/bin/sh\necho "stub ran: $*"\n');
    const app = await buildApp({ config: loadConfig({ HERMES_BIN: bin }), disableAuth: true });

    const registry = await app.inject({ method: 'POST', url: '/api/cli/commands/lsp.status/run' });
    expect(registry.statusCode).toBe(200);
    expect(registry.json().stdout).toContain('stub ran: lsp status');

    const unknown = await app.inject({ method: 'POST', url: '/api/cli/commands/nope/run' });
    expect(unknown.statusCode).toBe(404);

    const freeform = await app.inject({
      method: 'POST',
      url: '/api/cli/run',
      payload: { command: 'hermes doctor' },
    });
    expect(freeform.statusCode).toBe(200);
    expect(freeform.json().stdout).toContain('doctor');

    const denied = await app.inject({
      method: 'POST',
      url: '/api/cli/run',
      payload: { command: 'hermes update' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('NOT_ALLOWLISTED');

    const operator = await app.inject({
      method: 'POST',
      url: '/api/cli/run',
      payload: { command: 'hermes status; rm -rf /' },
    });
    expect(operator.statusCode).toBe(400);
    expect(operator.json().error.code).toBe('SHELL_OPERATOR_FORBIDDEN');

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/cli/run',
      payload: { command: 'ls -la' },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.code).toBe('HERMES_BINARY_ONLY');
  });
});
