/**
 * Active-run registry (localStorage).
 *
 * The gateway exposes no run-history listing (capability matrix, section 1:
 * no GET /v1/runs), so the WebUI tracks its own sessionId -> runId mapping to
 * survive page reloads mid-run and to reattach after reconnects. Hermes
 * remains the source of truth for the run itself; this registry only remembers
 * where to look.
 */

const KEY = 'hermes-webui-active-runs';

type Registry = Record<string, string>;

function readRegistry(): Registry {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Registry) : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry: Registry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(registry));
  } catch {
    // storage unavailable: reconnect registry is best-effort
  }
}

export function loadActiveRunId(sessionId: string): string | null {
  return readRegistry()[sessionId] ?? null;
}

export function saveActiveRunId(sessionId: string, runId: string | null): void {
  const registry = readRegistry();
  if (runId === null) {
    delete registry[sessionId];
  } else {
    registry[sessionId] = runId;
  }
  writeRegistry(registry);
}
