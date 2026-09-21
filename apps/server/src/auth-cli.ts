#!/usr/bin/env node
/**
 * Local auth recovery CLI (Phase 1, spec 2.8). Runs on the host with
 * filesystem access — never exposed over HTTP.
 *
 *   node dist/auth-cli.js setup-token --rotate
 *   node dist/auth-cli.js reset-owner-password [username]
 */

import readline from 'node:readline/promises';
import { loadConfig } from './config';
import { openDatabase } from './db/database';
import { AuthStore } from './auth/store';
import { AuthService } from './auth/service';
import { validatePasswordPolicy } from './auth/passwords';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const [, , command, flag, ...rest] = process.argv;
  const config = loadConfig();
  const { db } = openDatabase(config.dataDir);
  const store = new AuthStore(db);
  const service = new AuthService(store, config.session, config.dataDir, {
    attempt: () => true,
    failure: () => undefined,
    success: () => undefined,
  });

  if (command === 'setup-token' && (flag === '--rotate' || flag === '-r')) {
    if (store.isClaimed()) {
      console.error('Instance is already claimed; setup tokens are permanently disabled.');
      return 1;
    }
    const file = service.rotateSetupToken();
    console.log(`New setup token written to: ${file}`);
    return 0;
  }

  if (command === 'reset-owner-password') {
    const username = rest[0] ?? (await prompt('Username: '));
    const password = await prompt('New password: ');
    const confirm = await prompt('Confirm new password: ');
    if (password !== confirm) {
      console.error('Passwords do not match.');
      return 1;
    }
    const policyError = validatePasswordPolicy(password);
    if (policyError !== null) {
      console.error(policyError);
      return 1;
    }
    const { revokedSessions } = await service.resetOwnerPasswordInteractively(username, password);
    console.log(`Password updated for "${username}". Revoked sessions: ${revokedSessions}`);
    return 0;
  }

  console.error(`Usage:
  auth-cli setup-token --rotate        rotate the first-boot setup token (unclaimed only)
  auth-cli reset-owner-password [user] interactive local owner password reset`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
