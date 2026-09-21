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
  /** WebUI version reported by /api/app/status. */
  appVersion: string;
}

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: intFromEnv(env.PORT, 8789),
    hermesBaseUrl: env.HERMES_BASE_URL ?? 'http://127.0.0.1:8642',
    hermesDashboardUrl: env.HERMES_DASHBOARD_URL ?? 'http://127.0.0.1:49173',
    hermesDashboardToken: env.HERMES_DASHBOARD_SESSION_TOKEN,
    appVersion: env.npm_package_version ?? '0.0.0-dev',
  };
}
