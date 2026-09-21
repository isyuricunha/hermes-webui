import fs from 'node:fs';
import path from 'node:path';
import type { SessionLifetimes } from './store';
import type { AuthStore } from './store';
import { normalizeUsername, validateUsername } from './store';
import { hashPassword, verifyPassword, fakeVerifyForTiming, validatePasswordPolicy } from './passwords';
import { constantTimeEqual, sha256Hex } from './tokens';

/**
 * Auth service (Phase 1, spec 2.7-2.8): first-boot setup/claim, login,
 * logout, re-authentication, password change, session management, recovery.
 * All state transitions happen here; the Fastify layer only translates
 * HTTP <-> these calls.
 */

export type AuthErrorCode =
  | 'SETUP_REQUIRED'
  | 'SETUP_TOKEN_INVALID'
  | 'SETUP_ALREADY_CLAIMED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_REAUTH_REQUIRED'
  | 'AUTH_VALIDATION_ERROR';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly httpStatus: number = 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface AuthResult {
  user: { id: string; username: string; displayName: string | null; role: string };
  session: {
    id: string;
    cookieToken: string;
    csrfToken: string;
    expiresAt: number;
    absoluteExpiresAt: number;
    reauthUntil: number | null;
  };
}

export interface LoginRateLimiter {
  /** Returns true when the attempt is allowed (limit = max failures in window). */
  attempt(key: string, limit: number, windowMs?: number): boolean;
  failure(key: string): void;
  success(key: string): void;
}

export interface AuthRequestContext {
  userAgent: string | null;
  clientIpHash: string | null;
}

const SETUP_WINDOW_MS = 15 * 60 * 1000;

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly lifetimes: SessionLifetimes,
    private readonly dataDir: string,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  // --- bootstrap/setup -------------------------------------------------------

  isClaimed(): boolean {
    return this.store.isClaimed();
  }

  /** Spec 2.7: one-time token pair (DB hash + file) must be consistent. */
  ensureBootstrapToken(): string {
    const tokenFile = this.setupTokenFile();
    const dbHash = this.store.getBootstrapTokenHash();
    const fileExists = fs.existsSync(tokenFile);
    if (dbHash !== null && fileExists) {
      return tokenFile;
    }
    // Missing or inconsistent pair (stale file, wiped DB row): regenerate both.
    const token = this.store.rotateBootstrapToken();
    fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
    return tokenFile;
  }

  rotateSetupToken(): string {
    if (this.store.isClaimed()) {
      throw new AuthError('AUTH_VALIDATION_ERROR', 'Instance is already claimed.', 409);
    }
    const token = this.store.rotateBootstrapToken();
    const tokenFile = this.setupTokenFile();
    fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
    return tokenFile;
  }

  private setupTokenFile(): string {
    return path.join(this.dataDir, 'setup-token');
  }

  async setup(input: {
    setupToken: string;
    username: string;
    displayName?: string;
    password: string;
    context: AuthRequestContext;
    requestId?: string;
  }): Promise<AuthResult> {
    if (this.store.isClaimed()) {
      this.store.appendAudit({
        event: 'setup.failure',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
        metadata: { reason: 'already_claimed' },
      });
      throw new AuthError('SETUP_ALREADY_CLAIMED', 'This instance is already set up.', 409);
    }
    const ipKey = input.context.clientIpHash ?? 'unknown';
    if (!this.rateLimiter.attempt(`setup:${ipKey}`, 5, SETUP_WINDOW_MS)) {
      this.store.appendAudit({
        event: 'setup.failure',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
        metadata: { reason: 'rate_limited' },
      });
      throw new AuthError('AUTH_RATE_LIMITED', 'Too many attempts. Try again later.', 429, 600);
    }
    const storedHash = this.store.getBootstrapTokenHash();
    if (storedHash === null || !constantTimeEqual(sha256Hex(input.setupToken.trim()), storedHash)) {
      this.rateLimiter.failure(`setup:${input.context.clientIpHash ?? 'unknown'}`);
      this.store.appendAudit({
        event: 'setup.failure',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
        metadata: { reason: 'invalid_token' },
      });
      throw new AuthError('SETUP_TOKEN_INVALID', 'Invalid setup token.', 403);
    }
    const usernameError = validateUsername(input.username);
    if (usernameError !== null) {
      throw new AuthError('AUTH_VALIDATION_ERROR', usernameError, 400);
    }
    const passwordError = validatePasswordPolicy(input.password);
    if (passwordError !== null) {
      throw new AuthError('AUTH_VALIDATION_ERROR', passwordError, 400);
    }
    if (input.displayName !== undefined && input.displayName.length > 128) {
      throw new AuthError('AUTH_VALIDATION_ERROR', 'Display name is too long.', 400);
    }

    const passwordHash = await hashPassword(input.password);
    const created = this.claimTransaction({
      username: input.username,
      displayName: input.displayName ?? null,
      passwordHash,
      context: input.context,
      requestId: input.requestId,
    });
    return this.toAuthResult(created.user, created.session, created.cookieToken);
  }

  private claimTransaction(input: {
    username: string;
    displayName: string | null;
    passwordHash: string;
    context: AuthRequestContext;
    requestId?: string;
  }): { user: NonNullable<ReturnType<AuthStore['getUserById']>>; session: ReturnType<AuthStore['createSession']>['session']; cookieToken: string } {
    const created = this.store.transaction(() => {
      // Recheck inside the transaction (spec 2.7): only one claim wins.
      if (this.store.isClaimed()) {
        throw new AuthError('SETUP_ALREADY_CLAIMED', 'This instance is already set up.', 409);
      }
      const user = this.store.createUser({
        username: input.username,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      });
      const createdSession = this.store.createSession(user.id, this.lifetimes, {
        userAgent: input.context.userAgent,
        clientIpHash: input.context.clientIpHash,
      });
      this.store.consumeBootstrapToken();
      try {
        fs.rmSync(this.setupTokenFile(), { force: true });
      } catch {
        // best-effort; token is already invalid server-side
      }
      this.store.appendAudit({
        userId: user.id,
        event: 'setup.success',
        outcome: 'success',
        ...input.context,
        requestId: input.requestId,
      });
      return { user, session: createdSession.session, cookieToken: createdSession.cookieToken };
    });
    return created;
  }

  // --- login/logout ----------------------------------------------------------

  async login(input: {
    username: string;
    password: string;
    context: AuthRequestContext;
    requestId?: string;
  }): Promise<AuthResult> {
    const usernameKey = normalizeUsername(input.username);
    const ipKey = input.context.clientIpHash ?? 'unknown';
    const perUserKey = `login:${ipKey}:${usernameKey}`;
    const perIpKey = `login-ip:${ipKey}`;
    if (!this.rateLimiter.attempt(perUserKey, 5) || !this.rateLimiter.attempt(perIpKey, 20)) {
      this.store.appendAudit({
        event: 'login.rate_limited',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
      });
      throw new AuthError('AUTH_RATE_LIMITED', 'Too many attempts. Try again later.', 429, 600);
    }

    const user = this.store.getUserByUsernameNormalized(usernameKey);
    let valid = false;
    if (user === undefined || user.disabled_at !== null) {
      await fakeVerifyForTiming(input.password);
    } else {
      valid = await verifyPassword(input.password, user.password_hash);
    }
    if (user === undefined || !valid || user.disabled_at !== null) {
      this.rateLimiter.failure(perUserKey);
      this.rateLimiter.failure(perIpKey);
      this.store.appendAudit({
        userId: user?.id ?? null,
        event: 'login.failure',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
      });
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Invalid username or password.', 401);
    }

    this.rateLimiter.success(perUserKey);
    this.rateLimiter.success(perIpKey);
    const created = this.store.createSession(user.id, this.lifetimes, {
      userAgent: input.context.userAgent,
      clientIpHash: input.context.clientIpHash,
    });
    this.store.appendAudit({
      userId: user.id,
      event: 'login.success',
      outcome: 'success',
      ...input.context,
      requestId: input.requestId,
    });
    return this.toAuthResult(user, created.session, created.cookieToken);
  }

  logout(session: { id: string; userId: string }, context: AuthRequestContext, requestId?: string): void {
    this.store.revokeSession(session.id);
    this.store.appendAudit({
      userId: session.userId,
      event: 'logout',
      outcome: 'success',
      ...context,
      requestId,
    });
  }

  // --- reauth / password -----------------------------------------------------

  async reauth(
    input: { password: string; context: AuthRequestContext; requestId?: string },
    session: { id: string; userId: string },
  ): Promise<void> {
    const user = this.store.getUserById(session.userId);
    const valid =
      user !== undefined && user.disabled_at === null && (await verifyPassword(input.password, user.password_hash));
    if (!valid) {
      this.store.appendAudit({
        userId: session.userId,
        event: 'reauth.failure',
        outcome: 'failure',
        ...input.context,
        requestId: input.requestId,
      });
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Invalid password.', 401);
    }
    this.store.setReauthUntil(session.id, Date.now() + this.lifetimes.recentAuthMs);
    this.store.appendAudit({
      userId: session.userId,
      event: 'reauth.success',
      outcome: 'success',
      ...input.context,
      requestId: input.requestId,
    });
  }

  async changePassword(input: {
    currentPassword: string;
    newPassword: string;
    context: AuthRequestContext;
    requestId?: string;
  }, session: { id: string; userId: string }): Promise<{
    cookieToken: string;
    csrfToken: string;
    expiresAt: number;
    absoluteExpiresAt: number;
    reauthUntil: number | null;
    revokedSessionIds: string[];
  }> {
    const user = this.store.getUserById(session.userId);
    if (user === undefined || !(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect.', 401);
    }
    const passwordError = validatePasswordPolicy(input.newPassword);
    if (passwordError !== null) {
      throw new AuthError('AUTH_VALIDATION_ERROR', passwordError, 400);
    }
    const passwordHash = await hashPassword(input.newPassword);
    const rotation = this.store.rotatePasswordAndSession({
      userId: user.id,
      passwordHash,
      oldSessionId: session.id,
      lifetimes: this.lifetimes,
      context: {
        userAgent: input.context.userAgent,
        clientIpHash: input.context.clientIpHash,
      },
    });
    this.store.appendAudit({
      userId: user.id,
      event: 'password.changed',
      outcome: 'success',
      ...input.context,
      requestId: input.requestId,
      metadata: { revokedSessions: rotation.revokedSessionIds.length },
    });
    return {
      cookieToken: rotation.created.cookieToken,
      csrfToken: rotation.created.session.csrf_token,
      expiresAt: rotation.created.session.idle_expires_at,
      absoluteExpiresAt: rotation.created.session.absolute_expires_at,
      reauthUntil: rotation.created.session.reauth_until,
      revokedSessionIds: rotation.revokedSessionIds,
    };
  }

  // --- recovery (local CLI only, spec 2.8) ------------------------------------

  async resetOwnerPasswordInteractively(
    username: string,
    newPassword: string,
  ): Promise<{ revokedSessions: string[] }> {
    const user = this.store.getUserByUsernameNormalized(normalizeUsername(username));
    if (user === undefined) {
      throw new AuthError('AUTH_VALIDATION_ERROR', 'No such user.', 404);
    }
    const passwordError = validatePasswordPolicy(newPassword);
    if (passwordError !== null) {
      throw new AuthError('AUTH_VALIDATION_ERROR', passwordError, 400);
    }
    const passwordHash = await hashPassword(newPassword);
    const revokedSessions: string[] = this.store.transaction(() => {
      this.store.updatePassword(user.id, passwordHash);
      return this.store.revokeOthersForUser(user.id, '');
    });
    this.store.appendAudit({
      userId: user.id,
      event: 'recovery.used',
      outcome: 'success',
      metadata: { revokedSessions },
    });
    return { revokedSessions };
  }

  // --- helpers -----------------------------------------------------------------

  private toAuthResult(
    user: { id: string; username: string; display_name: string | null; role: string },
    session: { id: string; csrf_token: string; idle_expires_at: number; absolute_expires_at: number; reauth_until: number | null },
    cookieToken: string,
  ): AuthResult {
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
      session: {
        id: session.id,
        cookieToken,
        csrfToken: session.csrf_token,
        expiresAt: session.idle_expires_at,
        absoluteExpiresAt: session.absolute_expires_at,
        reauthUntil: session.reauth_until,
      },
    };
  }
}
