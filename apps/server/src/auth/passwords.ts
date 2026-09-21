import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing (Phase 1 auth, spec 2.3): Argon2id with the parameters
 * fixed by the planner. Hashes are stored in full PHC format.
 */

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a PHC hash. A stored hash in an unexpected
 * format fails closed (never throws to the caller).
 */
export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  try {
    return await verify(phcHash, password);
  } catch {
    return false;
  }
}

/**
 * Dummy verification cost for unknown usernames (spec 2.10): keeps login
 * timing indistinguishable between "no such user" and "wrong password".
 * A real Argon2id hash of a throwaway secret, generated lazily once.
 */
let dummyHashPromise: Promise<string> | null = null;

export async function fakeVerifyForTiming(password: string): Promise<void> {
  dummyHashPromise ??= hash('dummy-verify-timing-secret', ARGON2_OPTIONS);
  try {
    await verify(await dummyHashPromise, password);
  } catch {
    // The point is spending comparable time, not the result.
  }
}
