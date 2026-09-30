import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { WriteApprovalBridge, type ExecFn } from '../src/hermes/writeApprovals';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webui-test-'));
}

describe('images the WebUI sent (Hermes keeps only "[screenshot]")', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the images of a send and serves them back for that session', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ run_id: 'r1', status: 'running' }), { headers: { 'content-type': 'application/json' } }),
    );
    const app = await buildApp({ disableAuth: true, dataDir: tempDir(), config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }) });
    const sent = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { session_id: 's1', input: [{ type: 'text', text: 'olha' }, { type: 'image_url', image_url: { url: PNG } }] },
    });
    expect(sent.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/api/sessions/s1/images' })).json() as { images: { id: number; position: number; mime: string }[] };
    expect(list.images).toHaveLength(1);
    expect(list.images[0]).toMatchObject({ position: 0, mime: 'image/png' });
    const image = await app.inject({ method: 'GET', url: `/api/images/${list.images[0]!.id}` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['content-security-policy']).toContain('sandbox');
    expect(image.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect((await app.inject({ method: 'GET', url: '/api/sessions/other/images' })).json()).toEqual({ images: [] });
    expect((await app.inject({ method: 'GET', url: '/api/images/9999' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/images/abc' })).statusCode).toBe(404);
  });
});

describe('memory files and skill delete through the Hermes bridge', () => {
  const RUNTIME = JSON.stringify(['/py', '-I', '-c', "sys.path.insert(0, '/src'); import hermes_bootstrap"]);
  function bridge(reply: (args: readonly string[]) => unknown) {
    const calls: (readonly string[])[] = [];
    const exec: ExecFn = async (_file, args) => {
      if (args[0] === '--print-runtime-command') return { stdout: RUNTIME, stderr: '', code: 0 };
      calls.push(args);
      return { stdout: `\u001eHXJSON${JSON.stringify(reply(args))}\n`, stderr: '', code: 0 };
    };
    return { calls, writeApprovals: new WriteApprovalBridge({ hermesBin: 'hermes', exec }) };
  }

  it('lists entries and applies add / replace / remove with argv only', async () => {
    const { calls, writeApprovals } = bridge((args) =>
      args[5] === 'entries' ? { entries: ['a', 'b'], chars: 3, limit: 2200, enabled: true } : { success: true, message: 'Entry saved.' },
    );
    const app = await buildApp({ disableAuth: true, dataDir: tempDir(), writeApprovals, config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }) });
    expect((await app.inject({ method: 'GET', url: '/api/memory-files/user' })).json()).toEqual({ entries: ['a', 'b'], chars: 3, limit: 2200, enabled: true });
    await app.inject({ method: 'POST', url: '/api/memory-files/memory', payload: { action: 'add', content: 'novo fato' } });
    await app.inject({ method: 'POST', url: '/api/memory-files/memory', payload: { action: 'replace', entry: 'a', content: 'A' } });
    const removed = await app.inject({ method: 'POST', url: '/api/memory-files/memory', payload: { action: 'remove', entry: 'b' } });
    expect(removed.json()).toEqual({ ok: true, message: 'Entry saved.' });
    expect(calls.map((args) => args.slice(4))).toEqual([
      ['memory-file', 'entries', 'user'],
      ['memory-file', 'add', 'memory', 'novo fato'],
      ['memory-file', 'replace', 'memory', JSON.stringify(['a', 'A'])],
      ['memory-file', 'remove', 'memory', 'b'],
    ]);
  });

  it('rejects bad targets and incomplete edits, and reports Hermes refusals as 422', async () => {
    const { calls, writeApprovals } = bridge(() => ({ success: false, error: 'Memory at 2,300/2,200 chars.' }));
    const app = await buildApp({ disableAuth: true, dataDir: tempDir(), writeApprovals, config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }) });
    expect((await app.inject({ method: 'GET', url: '/api/memory-files/secrets' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/memory-files/memory', payload: { action: 'replace', content: 'x' } })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    const refused = await app.inject({ method: 'POST', url: '/api/memory-files/memory', payload: { action: 'add', content: 'x' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toContain('2,300/2,200');
  });

  it('deletes a skill by validated name only', async () => {
    const { calls, writeApprovals } = bridge(() => ({ success: true, message: 'Skill deleted.' }));
    const app = await buildApp({ disableAuth: true, dataDir: tempDir(), writeApprovals, config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }) });
    expect((await app.inject({ method: 'DELETE', url: '/api/skills/old-notes' })).json()).toEqual({ ok: true, message: 'Skill deleted.' });
    expect((await app.inject({ method: 'DELETE', url: '/api/skills/..%2Fetc' })).statusCode).toBe(400);
    expect(calls.map((args) => args.slice(4))).toEqual([['skill', 'delete', 'old-notes']]);
  });
});
