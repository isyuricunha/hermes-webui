import type { HermesDashboardClient } from './dashboard';

/**
 * Runs Hermes slash commands the way Hermes' own desktop app does: over the
 * dashboard's JSON-RPC websocket (`/api/ws`, tui_gateway). A short-lived
 * ticket (`POST /api/auth/ws-ticket`) authenticates the socket; the stored
 * conversation is resumed lazily and `slash.exec` runs the command in
 * Hermes' slash worker. Commands that turn into a prompt (skills, /plan,
 * /queue...) come back as `send`, which the WebUI submits as a normal turn.
 *
 * One socket is shared and closed after a few idle minutes; each resumed
 * conversation keeps its runtime id (and Hermes keeps its slash worker warm,
 * so only the first command in a conversation pays the worker start).
 */

export type SlashResult =
  | { kind: 'output'; output: string; warning?: string }
  | { kind: 'send'; message: string; notice?: string }
  | { kind: 'prefill'; message: string; notice?: string }
  | { kind: 'error'; message: string };

export class SlashBridgeError extends Error {
  constructor(
    readonly code: 'SLASH_BRIDGE_UNAVAILABLE' | 'SLASH_BRIDGE_TIMEOUT',
    message: string,
  ) {
    super(message);
  }
}

/** Command text: "/name args", one line, bounded. */
export const SLASH_COMMAND = /^\/[a-z0-9][\w:.-]{0,63}(?:[ \t][^\n\r]{0,4000})?$/i;

interface RpcMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export interface SlashBridgeOptions {
  /** Test seam: builds the socket. */
  socketFactory?: (url: string, protocols: string[]) => SocketLike;
  callTimeoutMs?: number;
  idleCloseMs?: number;
}

const OPEN = 1;

export class HermesSlashBridge {
  private socket: SocketLike | null = null;
  private opening: Promise<SocketLike> | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, (message: RpcMessage) => void>();
  /** Stored session id -> runtime id on the current socket. */
  private readonly runtime = new Map<string, Promise<string>>();
  private scratch: Promise<string> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly socketFactory: NonNullable<SlashBridgeOptions['socketFactory']>;
  private readonly callTimeoutMs: number;
  private readonly idleCloseMs: number;

  constructor(
    private readonly dashboard: HermesDashboardClient,
    options: SlashBridgeOptions = {},
  ) {
    this.socketFactory =
      options.socketFactory ??
      ((url, protocols) => {
        if (typeof WebSocket === 'undefined') {
          throw new SlashBridgeError('SLASH_BRIDGE_UNAVAILABLE', 'This Node.js has no WebSocket client (Node 22+ needed).');
        }
        return new WebSocket(url, protocols) as unknown as SocketLike;
      });
    this.callTimeoutMs = options.callTimeoutMs ?? 90_000;
    this.idleCloseMs = options.idleCloseMs ?? 5 * 60_000;
  }

  async exec(command: string, sessionId?: string): Promise<SlashResult> {
    const socket = await this.connect();
    const runtimeId = await this.runtimeFor(socket, sessionId);
    const response = await this.call(socket, 'slash.exec', { session_id: runtimeId, command });
    if (response.error !== undefined) {
      const message = response.error.message ?? 'Hermes refused the command.';
      // Skill and bundle commands are dispatched, not executed by the worker.
      if (/use command\.dispatch/i.test(message)) {
        const [name = '', ...rest] = command.replace(/^\//, '').split(/\s+/);
        return this.normalize(
          await this.call(socket, 'command.dispatch', { session_id: runtimeId, name, arg: rest.join(' ') }),
        );
      }
      return { kind: 'error', message };
    }
    return this.normalize(response);
  }

  close(): void {
    this.reset();
  }

  private normalize(response: RpcMessage): SlashResult {
    if (response.error !== undefined) {
      return { kind: 'error', message: response.error.message ?? 'Hermes refused the command.' };
    }
    const result = response.result ?? {};
    const text = (key: string) => (typeof result[key] === 'string' ? (result[key] as string) : undefined);
    const type = text('type');
    if (type === 'send' && text('message') !== undefined) {
      return { kind: 'send', message: text('message') as string, ...(text('notice') ? { notice: text('notice') } : {}) };
    }
    if (type === 'prefill' && text('message') !== undefined) {
      return { kind: 'prefill', message: text('message') as string, ...(text('notice') ? { notice: text('notice') } : {}) };
    }
    if (type === 'alias' && text('target')) {
      return { kind: 'prefill', message: text('target') as string };
    }
    return {
      kind: 'output',
      output: text('output') ?? text('notice') ?? '(no output)',
      ...(text('warning') ? { warning: text('warning') } : {}),
    };
  }

  private runtimeFor(socket: SocketLike, sessionId: string | undefined): Promise<string> {
    if (sessionId === undefined) {
      // No conversation yet: a draft session (Hermes writes no row for it).
      this.scratch ??= this.call(socket, 'session.create', { close_on_disconnect: true }).then((response) =>
        this.runtimeIdOf(response),
      );
      this.scratch.catch(() => (this.scratch = null));
      return this.scratch;
    }
    let entry = this.runtime.get(sessionId);
    if (entry === undefined) {
      entry = this.call(socket, 'session.resume', {
        session_id: sessionId,
        lazy: true,
        omit_messages: true,
        close_on_disconnect: true,
      }).then((response) => this.runtimeIdOf(response));
      entry.catch(() => this.runtime.delete(sessionId));
      this.runtime.set(sessionId, entry);
    }
    return entry;
  }

  private runtimeIdOf(response: RpcMessage): string {
    const id = response.result?.session_id;
    if (response.error !== undefined || typeof id !== 'string') {
      throw new SlashBridgeError(
        'SLASH_BRIDGE_UNAVAILABLE',
        response.error?.message ?? 'Hermes could not open this conversation for commands.',
      );
    }
    return id;
  }

  private async connect(): Promise<SocketLike> {
    this.touch();
    if (this.socket !== null && this.socket.readyState === OPEN) return this.socket;
    this.opening ??= this.open().finally(() => (this.opening = null));
    return this.opening;
  }

  private async open(): Promise<SocketLike> {
    const ticketResponse = await this.dashboard.call<{ ticket?: string }>('POST', '/api/auth/ws-ticket');
    const ticket = ticketResponse?.ticket;
    if (typeof ticket !== 'string' || ticket === '') {
      throw new SlashBridgeError('SLASH_BRIDGE_UNAVAILABLE', 'The Hermes dashboard gave no websocket ticket.');
    }
    const url = `${this.dashboard.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/ws`;
    const socket = this.socketFactory(url, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SlashBridgeError('SLASH_BRIDGE_TIMEOUT', 'The Hermes websocket did not open.')), 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new SlashBridgeError('SLASH_BRIDGE_UNAVAILABLE', 'Could not open the Hermes websocket.'));
      };
    });
    socket.onmessage = (event) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(String(event.data)) as RpcMessage;
      } catch {
        return;
      }
      if (typeof message.id === 'number') {
        const resolve = this.pending.get(message.id);
        if (resolve !== undefined) {
          this.pending.delete(message.id);
          resolve(message);
        }
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.reset();
    };
    socket.onerror = () => undefined;
    this.socket = socket;
    return socket;
  }

  private call(socket: SocketLike, method: string, params: Record<string, unknown>): Promise<RpcMessage> {
    this.touch();
    return new Promise((resolve, reject) => {
      this.nextId += 1;
      const id = this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SlashBridgeError('SLASH_BRIDGE_TIMEOUT', `Hermes did not answer ${method} in time.`));
      }, this.callTimeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new SlashBridgeError('SLASH_BRIDGE_UNAVAILABLE', error instanceof Error ? error.message : 'send failed'));
      }
    });
  }

  private touch(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.reset(), this.idleCloseMs);
    this.idleTimer.unref?.();
  }

  private reset(): void {
    const socket = this.socket;
    this.socket = null;
    this.runtime.clear();
    this.scratch = null;
    for (const resolve of this.pending.values()) {
      resolve({ error: { message: 'The Hermes websocket closed.' } });
    }
    this.pending.clear();
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    try {
      socket?.close();
    } catch {
      // already closed
    }
  }
}
