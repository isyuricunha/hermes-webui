import type { AppStatus } from '@hermes-webui/shared';

/**
 * Browser-side access to the WebUI backend. The browser never talks to
 * Hermes directly (PRD 47): auth, secrets, normalization and the CLI bridge
 * all live behind this boundary.
 */

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchAppStatus(): Promise<AppStatus> {
  return requestJson<AppStatus>('/api/app/status');
}
