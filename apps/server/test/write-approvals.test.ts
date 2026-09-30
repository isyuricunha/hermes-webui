import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { WriteApprovalBridge, parseRuntimeCommand, type ExecFn } from '../src/hermes/writeApprovals';

const RUNTIME = JSON.stringify([
  '/opt/hermes/python3',
  '-I',
  '-c',
  "import os, sys, runpy; sys.path.insert(0, '/opt/hermes/src'); import hermes_bootstrap; runpy.run_module('hermes_cli.main')",
]);

function fakeExec(reply: (args: readonly string[]) => { stdout: string; stderr?: string; code?: number }) {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    if (args[0] === '--print-runtime-command') return { stdout: `${RUNTIME}\n`, stderr: '', code: 0 };
    const result = reply(args);
    return { stdout: result.stdout, stderr: result.stderr ?? '', code: result.code ?? 0 };
  };
  return { exec, calls };
}

const out = (value: unknown) => `some log line\n\u001eHXJSON${JSON.stringify(value)}\n`;

describe('write-approval bridge', () => {
  it('parses the launcher runtime command', () => {
    expect(parseRuntimeCommand(RUNTIME)).toEqual({ python: '/opt/hermes/python3', source: '/opt/hermes/src' });
    expect(parseRuntimeCommand('not json')).toBeNull();
    expect(parseRuntimeCommand('["/py", "-c", "print(1)"]')).toBeNull();
  });

  it('lists pending writes with Hermes own runtime, argv only', async () => {
    const pending = [{ id: '013e8393', action: 'add', summary: 'x', origin: 'assistant_tool', created_at: 1, operations: [] }];
    const { exec, calls } = fakeExec(() => ({ stdout: out({ enabled: true, pending }) }));
    const bridge = new WriteApprovalBridge({ hermesBin: 'hermes', exec });
    await expect(bridge.list('memory')).resolves.toEqual({ enabled: true, pending });
    const run = calls[1]!;
    expect(run.file).toBe('/opt/hermes/python3');
    expect(run.args.slice(0, 2)).toEqual(['-I', '-c']);
    expect(run.args.slice(3)).toEqual(['/opt/hermes/src', 'memory', 'list']);
    // The runtime lookup is cached.
    await bridge.list('skills');
    expect(calls.filter((call) => call.args[0] === '--print-runtime-command')).toHaveLength(1);
  });

  it('reports approvals, failures and unknown ids from Hermes messages', async () => {
    const messages: Record<string, string> = {
      a1: 'Approved 1 memory write(s).',
      b2: "No pending memory write with id 'b2'.",
      c3: 'Approved 0 memory write(s).\nFailed:\n  c3: memory store unavailable',
    };
    const { exec, calls } = fakeExec((args) => ({ stdout: out({ message: messages[args[args.length - 1]!] }) }));
    const bridge = new WriteApprovalBridge({ hermesBin: 'hermes', exec });
    await expect(bridge.resolve('memory', 'approve', 'a1')).resolves.toEqual({ ok: true, message: messages.a1 });
    await expect(bridge.resolve('memory', 'approve', 'b2')).resolves.toMatchObject({ ok: false });
    await expect(bridge.resolve('memory', 'approve', 'c3')).resolves.toMatchObject({ ok: false });
    expect(calls[1]!.args.slice(3)).toEqual(['/opt/hermes/src', 'memory', 'approve', 'a1']);
    await expect(bridge.resolve('memory', 'reject', '../x')).rejects.toThrow('Invalid pending write id.');
  });

  it('surfaces a failing Hermes runtime as an error, not an empty queue', async () => {
    const { exec } = fakeExec(() => ({ stdout: '', stderr: 'Traceback\nModuleNotFoundError: tools', code: 1 }));
    const bridge = new WriteApprovalBridge({ hermesBin: 'hermes', exec });
    await expect(bridge.list('memory')).rejects.toThrow(/ModuleNotFoundError/);
  });
});

describe('write-approval routes', () => {
  async function appWith(exec: ExecFn) {
    return buildApp({
      disableAuth: true,
      config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }),
      writeApprovals: new WriteApprovalBridge({ hermesBin: 'hermes', exec }),
    });
  }

  it('lists and resolves, validating subsystem, id and action', async () => {
    const { exec, calls } = fakeExec((args) =>
      args.includes('list') ? { stdout: out({ enabled: true, pending: [] }) } : { stdout: out({ message: 'Rejected 2 pending memory write(s).' }) },
    );
    const app = await appWith(exec);
    const list = await app.inject({ method: 'GET', url: '/api/write-approvals/memory' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ enabled: true, pending: [] });
    const reject = await app.inject({ method: 'POST', url: '/api/write-approvals/memory/all/reject' });
    expect(reject.json()).toEqual({ ok: true, message: 'Rejected 2 pending memory write(s).' });
    const before = calls.length;
    for (const url of [
      '/api/write-approvals/secrets',
      '/api/write-approvals/memory/a1/delete',
      '/api/write-approvals/memory/a%20b/approve',
      '/api/write-approvals/config/a1/approve',
    ]) {
      const response = await app.inject({ method: url.split('/').length > 4 ? 'POST' : 'GET', url });
      expect(response.statusCode, url).toBe(400);
    }
    expect(calls.length).toBe(before);
  });

  it('answers 503 when the Hermes runtime cannot be found', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: 'not found', code: 127 });
    const app = await appWith(exec);
    const response = await app.inject({ method: 'GET', url: '/api/write-approvals/memory' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('WRITE_APPROVALS_UNAVAILABLE');
  });
});
