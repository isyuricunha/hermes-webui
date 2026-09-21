import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { generateToken, sha256Hex } from './tokens';
import type { ServerConfig } from '../config';

export type SessionLifetimes = ServerConfig['session'];

/**
 * Auth persistence (Phase 1, spec 2.4): users, sessions, bootstrap token and
 * audit log. Session cookies are random 32-byte tokens; the database stores
 * only their SHA-256 hashes.
 */

export interface UserRow {
  id: string;
  username: string;
  username_normalized: string;
  display_name: string | null;
  password_hash: string;
  role: string;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
  disabled_at: number | null;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  csrf_token: string;
  created_at: number;
  last_seen_at: number;
  idle_expires_at: number;
  absolute_expires_at: number;
  reauth_until: number | null;
  user_agent: string | null;
  client_ip_hash: string | null;
  revoked_at: number | null;
}

export interface CreatedSession {
  session: SessionRow;
  /** Plaintext cookie token — returned once, stored only as a hash. */
  cookieToken: string;
}

export interface AuditEntry {
  userId?: string | null;
  event: string;
  outcome: 'success' | 'failure';
  clientIpHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const normalized = username.trim();
  if (normalized.length < 3 || normalized.length > 64) {
    return 'Username must be 3-64 characters.';
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(normalized)) {
    return 'Username may contain letters, numbers, dot, underscore and hyphen only.';
  }
  return null;
}

export class AuthStore {
  constructor(private readonly db: Database.Database) {}

  /** Runs `fn` inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // --- bootstrap -----------------------------------------------------------

  isClaimed(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return row.count > 0;
  }

  createBootstrapToken(): string {
    const token = generateToken(32);
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM auth_bootstrap WHERE id = 1').run();
      this.db
        .prepare('INSERT INTO auth_bootstrap (id, token_hash, created_at) VALUES (1, ?, ?)')
        .run(sha256Hex(token), Date.now());
    });
    run();
    return token;
  }

  rotateBootstrapToken(): string {
    return this.createBootstrapToken();
  }

  getBootstrapTokenHash(): string | null {
    const row = this.db.prepare('SELECT token_hash FROM auth_bootstrap WHERE id = 1').get() as
      | { token_hash: string }
      | undefined;
    return row?.token_hash ?? null;
  }

  consumeBootstrapToken(): void {
    this.db.prepare('DELETE FROM auth_bootstrap WHERE id = 1').run();
  }

  // --- users -----------------------------------------------------------------

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return row.count;
  }

  getUserByUsernameNormalized(usernameNormalized: string): UserRow | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE username_normalized = ?')
      .get(usernameNormalized) as UserRow | undefined;
  }

  getUserById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  createUser(input: {
    username: string;
    displayName: string | null;
    passwordHash: string;
    role?: string;
  }): UserRow {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users
           (id, username, username_normalized, display_name, password_hash, role,
            created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.username.trim(),
        normalizeUsername(input.username),
        input.displayName,
        input.passwordHash,
        input.role ?? 'owner',
        now,
        now,
        now,
      );
    return this.getUserById(id) as UserRow;
  }

  updatePassword(userId: string, passwordHash: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, Date.now(), Date.now(), userId);
  }

  // --- sessions --------------------------------------------------------------

  createSession(
    userId: string,
    lifetimes: SessionLifetimes,
    context: { userAgent?: string | null; clientIpHash?: string | null },
  ): CreatedSession {
    const cookieToken = generateToken(32);
    const now = Date.now();
    const row: SessionRow = {
      id: randomUUID(),
      token_hash: sha256Hex(cookieToken),
      user_id: userId,
      csrf_token: generateToken(32),
      created_at: now,
      last_seen_at: now,
      idle_expires_at: now + lifetimes.idleMs,
      absolute_expires_at: now + lifetimes.absoluteMs,
      reauth_until: now + lifetimes.recentAuthMs,
      user_agent: context.userAgent?.slice(0, 256) ?? null,
      client_ip_hash: context.clientIpHash ?? null,
      revoked_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, token_hash, user_id, csrf_token, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at, reauth_until, user_agent, client_ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.token_hash,
        row.user_id,
        row.csrf_token,
        row.created_at,
        row.last_seen_at,
        row.idle_expires_at,
        row.absolute_expires_at,
        row.reauth_until,
        row.user_agent,
        row.client_ip_hash,
      );
    return { session: row, cookieToken };
  }

  getSessionByTokenHash(tokenHash: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | SessionRow
      | undefined;
  }

  touchSession(sessionId: string, lastSeenAt: number, idleExpiresAt: number): void {
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?')
      .run(lastSeenAt, idleExpiresAt, sessionId);
  }

  setReauthUntil(sessionId: string, reauthUntil: number): void {
    this.db.prepare('UPDATE sessions SET reauth_until = ? WHERE id = ?').run(reauthUntil, sessionId);
  }

  rotateSession(oldSessionId: string, userId: string, lifetimes: SessionLifetimes): CreatedSession {
    this.revokeSession(oldSessionId);
    return this.createSession(userId, lifetimes, {});
  }

  revokeSession(sessionId: string): void {
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(Date.now(), sessionId);
  }

  revokeAllForUser(userId: string, exceptSessionId?: string): number {
    const info = exceptSessionId
      ? this.db
          .prepare(
            'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
          )
          .run(Date.now(), userId, exceptSessionId)
      : this.db
          .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
          .run(Date.now(), userId);
    return info.changes;
  }

  listSessionsForUser(userId: string): SessionRow[] {
    return this.db
      .prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
      )
      .all(userId) as SessionRow[];
  }

  // --- audit -----------------------------------------------------------------

  appendAudit(entry: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO auth_audit
           (timestamp, user_id, event, outcome, client_ip_hash, user_agent, metadata_json, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        entry.userId ?? null,
        entry.event,
        entry.outcome,
        entry.clientIpHash ?? null,
        entry.userAgent?.slice(0, 256) ?? null,
        entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
        entry.requestId ?? null,
      );
  }
}
