import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { HermesDashboardClient } from '../src/hermes/dashboard';
import { HermesSlashBridge } from '../src/hermes/slashBridge';
import { contextFromSessionRow } from '../src/routes/sessionContext';
import { safeFileName } from '../src/uploads';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webui-r4-'));
}

/** A fake tui_gateway: answers JSON-RPC like the dashboard websocket. */
function fakeGateway(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const seen: { url: string; protocols: string[]; calls: { method: string; params: Record<string, unknown> }[] } = {
    url: '',
    protocols: [],
    calls: [],
  };
  const factory = (url: string, protocols: string[]) => {
    seen.url = url;
    seen.protocols = protocols;
    const socket = {
      readyState: 1,
      onopen: null as ((event: unknown) => void) | null,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onclose: null as ((event: unknown) => void) | null,
      send(data: string) {
        const message = JSON.parse(data) as { id: number; method: string; params: Record<string, unknown> };
        seen.calls.push({ method: message.method, params: message.params });
        const reply = handler(message.method, message.params);
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(reply as object) }) }), 0);
      },
      close() {
        socket.readyState = 3;
      },
    };
    setTimeout(() => socket.onopen?.({}), 0);
    return socket;
  };
  return { seen, factory };
}

function dashboardWithTicket(): HermesDashboardClient {
  return new HermesDashboardClient('http://127.0.0.1:49173', undefined, {
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ticket: 't-123' }), { headers: { 'content-type': 'application/json' } })) as typeof fetch,
  });
}

describe('slash bridge (dashboard websocket)', () => {
  it('resumes the conversation once and runs commands in it', async () => {
    const gateway = fakeGateway((method, params) => {
      if (method === 'session.resume') return { result: { session_id: `rt-${String(params.session_id)}` } };
      if (method === 'slash.exec') return { result: { output: `ran ${String(params.command)} in ${String(params.session_id)}` } };
      return { error: { message: 'unexpected' } };
    });
    const bridge = new HermesSlashBridge(dashboardWithTicket(), { socketFactory: gateway.factory as never });
    expect(await bridge.exec('/reasoning', 'api_1')).toEqual({ kind: 'output', output: 'ran /reasoning in rt-api_1' });
    expect(await bridge.exec('/version', 'api_1')).toEqual({ kind: 'output', output: 'ran /version in rt-api_1' });
    expect(gateway.seen.url).toBe('ws://127.0.0.1:49173/api/ws');
    expect(gateway.seen.protocols).toEqual(['hermes-gateway-v1', 'hermes-gateway-ticket.t-123']);
    expect(gateway.seen.calls.filter((call) => call.method === 'session.resume')).toHaveLength(1);
    expect(gateway.seen.calls[0]?.params).toMatchObject({ session_id: 'api_1', lazy: true, close_on_disconnect: true });
    bridge.close();
  });

  it('dispatches skill commands and returns prompts to send', async () => {
    const gateway = fakeGateway((method) => {
      if (method === 'session.create') return { result: { session_id: 'draft' } };
      if (method === 'slash.exec') return { error: { code: 4018, message: 'skill command: use command.dispatch for /yutheme' } };
      if (method === 'command.dispatch') return { result: { type: 'send', message: 'Use the yutheme skill', notice: 'Loaded skill' } };
      return { error: { message: 'unexpected' } };
    });
    const bridge = new HermesSlashBridge(dashboardWithTicket(), { socketFactory: gateway.factory as never });
    expect(await bridge.exec('/yutheme make it gold')).toEqual({ kind: 'send', message: 'Use the yutheme skill', notice: 'Loaded skill' });
    expect(gateway.seen.calls.find((call) => call.method === 'command.dispatch')?.params).toMatchObject({
      session_id: 'draft',
      name: 'yutheme',
      arg: 'make it gold',
    });
    bridge.close();
  });

  it('exposes POST /api/commands/exec with a strict body', async () => {
    const exec = vi.fn(async () => ({ kind: 'output' as const, output: 'ok' }));
    const app = await buildApp({
      disableAuth: true,
      dataDir: tempDir(),
      config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local' }),
      slashBridge: { exec, close: () => undefined } as unknown as HermesSlashBridge,
    });
    const ok = await app.inject({ method: 'POST', url: '/api/commands/exec', payload: { command: '/version', sessionId: 'api_1' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ kind: 'output', output: 'ok' });
    expect(exec).toHaveBeenCalledWith('/version', 'api_1');
    for (const payload of [{ command: 'hello' }, { command: '/x\nrm -rf /' }, { command: '/ok', sessionId: '../etc' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/commands/exec', payload })).statusCode).toBe(400);
    }
    await app.close();
  });
});

describe('uploads (files Hermes reads from disk)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves any file type and serves it back for download', async () => {
    const dir = tempDir();
    const app = await buildApp({
      disableAuth: true,
      dataDir: dir,
      config: loadConfig({ HERMES_WEBUI_AUTH_MODE: 'local', HERMES_WEBUI_UPLOAD_MAX_MB: '1' }),
    });
    const audio = Buffer.from('ID3fake-mp3-bytes');
    const saved = await app.inject({
      method: 'POST',
      url: `/api/uploads?name=${encodeURIComponent('../../voz da reunião.mp3')}`,
      headers: { 'content-type': 'audio/mpeg' },
      payload: audio,
    });
    expect(saved.statusCode).toBe(201);
    const body = saved.json() as { id: string; name: string; kind: string; path: string; url: string; size: number };
    expect(body).toMatchObject({ name: 'voz da reunião.mp3', kind: 'audio', size: audio.length });
    expect(body.path.startsWith(path.join(dir, 'uploads'))).toBe(true);
    expect(fs.readFileSync(body.path)).toEqual(audio);
    const served = await app.inject({ method: 'GET', url: body.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('audio/mpeg');
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.rawPayload).toEqual(audio);
    expect((await app.inject({ method: 'GET', url: '/api/uploads/not-an-id' })).statusCode).toBe(404);
    const tooBig = await app.inject({
      method: 'POST',
      url: '/api/uploads?name=big.bin',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(1024 * 1024 + 10),
    });
    expect(tooBig.statusCode).toBe(413);
    await app.close();
  });

  it('keeps file names readable and harmless', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('rel$atório;final.pdf')).toBe('rel_atório_final.pdf');
    expect(safeFileName('...')).toBe('file');
    expect(safeFileName('a\u0000b.txt')).toBe('ab.txt');
  });
});

describe('conversation context', () => {
  it('reads the last prompt size and the window of the default model', () => {
    const row = {
      model: 'model-large',
      model_config: JSON.stringify({ _usage_anchor: { prompt_tokens: 45029 } }),
      message_count: 6,
      api_call_count: 3,
      input_tokens: 73951,
      output_tokens: 1867,
      cache_read_tokens: 55232,
      system_prompt: 'secret-ish',
    };
    const info = contextFromSessionRow(row, { model: 'model-large', effective_context_length: 1310720 });
    expect(info).toMatchObject({ model: 'model-large', used: 45029, contextLength: 1310720, messages: 6, apiCalls: 3 });
    expect(JSON.stringify(info)).not.toContain('secret-ish');
    expect(contextFromSessionRow({ ...row, model: 'other' }, { model: 'model-large', effective_context_length: 1 }).contextLength).toBeNull();
    expect(contextFromSessionRow({ model_config: 'not json' }, null).used).toBeNull();
  });
});
