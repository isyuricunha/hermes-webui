import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader for local development (no dependency). Production
 * deployments pass real environment variables via the service unit.
 *
 * Only sets variables that are not already present in `process.env` (real
 * environment always wins), and never overrides Hermes-owned variables.
 */

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') {
      result[key] = value;
    }
  }
  return result;
}

export function loadDotEnvIntoProcess(envDir: string = process.cwd()): void {
  const envPath = path.join(envDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
