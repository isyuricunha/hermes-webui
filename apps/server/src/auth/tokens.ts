import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token helpers (Phase 1 auth, spec 2.4/2.5): the session cookie carries a
 * random 32-byte base64url token; the database stores only its SHA-256 hash.
 * Comparisons are constant-time.
 */

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing uniform, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
