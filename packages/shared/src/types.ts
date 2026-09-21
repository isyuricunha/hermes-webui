/**
 * Shared domain types between the Hermes WebUI backend and frontend.
 *
 * Hermes is the source of truth. These types model what the WebUI itself
 * exposes and the normalized view it presents; they must never duplicate
 * Hermes-owned state (sessions, messages, runs, config) beyond what the UI
 * needs to render.
 */

export interface AppStatus {
  app: 'hermes-webui';
  version: string;
  hermes: HermesConnectivity;
}

export type HermesConnectivity =
  | { state: 'connected'; baseUrl: string; version: string }
  | { state: 'degraded'; baseUrl: string; reason: 'auth_failed' }
  | { state: 'offline'; baseUrl: string; error: string };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export interface HealthResponse {
  ok: true;
}
