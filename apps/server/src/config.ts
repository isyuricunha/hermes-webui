import path from 'node:path';
import packageJson from '../package.json';
import os from 'node:os';

/**
 * WebUI process configuration.
 *
 * This is the WebUI's OWN configuration, read from the process environment.
 * It must never duplicate Hermes configuration: Hermes settings stay in
 * Hermes (config.yaml / .env) and are accessed through adapters.
 */

export interface ServerConfig {
  host: string;
  port: number;
  hermesBaseUrl: string;
  hermesDashboardUrl: string;
  hermesDashboardToken?: string;
  /** Gateway API_SERVER_KEY. Server-side only; never sent to the browser. */
  hermesApiKey?: string;
  /** Hermes binary for the restricted CLI bridge. */
  hermesBin: string;
  /**
   * Hermes' Python interpreter and source dir for the write-approval bridge.
   * Optional: discovered with `hermes --print-runtime-command` when unset.
   */
  hermesPython?: string;
  hermesSourceDir?: string;
  /** Built web assets directory; served in production (PRD 42.5). */
  webDistDir: string;
  /** WebUI version reported by /api/app/status. */
  appVersion: string;
  /**
   * WebUI-owned data directory (SQLite database, setup token file).
   * Phase 1 auth (spec 2.2): never mixed with ~/.hermes state.
   */
  dataDir: string;
  /**
   * Where files attached in the chat are saved (default: <dataDir>/uploads).
   * Hermes reads them from this path, so it must be visible to the Hermes
   * process (same machine, or a shared volume).
   */
  uploadDir?: string;
  /** Largest file one attachment may be, in MB (default 100). */
  uploadMaxMb: number;
  /**
   * Trusted reverse proxy addresses (spec 2.14). Default: none — client IP,
   * HTTPS detection and rate limiting never trust forwarded headers unless
   * an explicit IP/CIDR list is configured.
   */
  trustProxy: string[];
  /** Session lifetimes (spec 2.6). */
  session: {
    idleMs: number;
    absoluteMs: number;
    recentAuthMs: number;
  };
  /**
   * Cookie Secure flag policy (spec 2.5): "auto" marks the cookie Secure
   * when request.protocol is https (honoring trusted proxy); "always" marks
   * it unconditionally (for deployments that terminate TLS elsewhere).
   */
  cookieSecureMode: 'auto' | 'always';
  /**
   * Who verifies credentials. "hermes" (default): sign-in uses the Hermes
   * dashboard's own username/password provider, so there is exactly one
   * credential to manage; the WebUI never stores the password. "local": the
   * WebUI's own Argon2id user store with the one-time setup claim.
   */
  authMode: 'hermes' | 'local';
  /** Dashboard password provider used in "hermes" auth mode. */
  hermesAuthProvider: string;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultDataDir(env: NodeJS.ProcessEnv): string {
  if (env.HERMES_WEBUI_DATA_DIR !== undefined && env.HERMES_WEBUI_DATA_DIR !== '') {
    return env.HERMES_WEBUI_DATA_DIR;
  }
  const xdg = env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'hermes-webui');
}

/**
 * Trusted proxy list: comma-separated IPs/CIDRs. A literal "true" is
 * deliberately rejected (spec 2.14) — trusting every hop would let any
 * client spoof its address.
 */
function trustProxyFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.HERMES_WEBUI_TRUST_PROXY;
  if (raw === undefined || raw.trim() === '' || raw.trim().toLowerCase() === 'false') {
    return [];
  }
  if (raw.trim().toLowerCase() === 'true') {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: intFromEnv(env.PORT, 8789),
    hermesBaseUrl: env.HERMES_BASE_URL ?? 'http://127.0.0.1:8642',
    hermesDashboardUrl: env.HERMES_DASHBOARD_URL ?? 'http://127.0.0.1:49173',
    hermesDashboardToken: env.HERMES_DASHBOARD_SESSION_TOKEN,
    hermesApiKey: env.HERMES_API_KEY,
    hermesBin: env.HERMES_BIN ?? 'hermes',
    hermesPython: env.HERMES_PYTHON,
    hermesSourceDir: env.HERMES_SOURCE_DIR,
    webDistDir: env.WEB_DIST_DIR ?? path.resolve(process.cwd(), '../web/dist'),
    appVersion: packageJson.version,
    dataDir: defaultDataDir(env),
    uploadDir: env.HERMES_WEBUI_UPLOAD_DIR,
    uploadMaxMb: intFromEnv(env.HERMES_WEBUI_UPLOAD_MAX_MB, 100),
    trustProxy: trustProxyFromEnv(env),
    session: {
      idleMs: intFromEnv(env.HERMES_WEBUI_SESSION_IDLE_HOURS, 24 * 7) * 60 * 60 * 1000,
      absoluteMs: intFromEnv(env.HERMES_WEBUI_SESSION_ABSOLUTE_DAYS, 30) * 24 * 60 * 60 * 1000,
      recentAuthMs: intFromEnv(env.HERMES_WEBUI_REAUTH_MINUTES, 10) * 60 * 1000,
    },
    cookieSecureMode:
      env.HERMES_WEBUI_COOKIE_SECURE === 'always' ? ('always' as const) : ('auto' as const),
    authMode: env.HERMES_WEBUI_AUTH_MODE === 'local' ? ('local' as const) : ('hermes' as const),
    hermesAuthProvider: env.HERMES_WEBUI_HERMES_AUTH_PROVIDER ?? 'basic',
  };
}
