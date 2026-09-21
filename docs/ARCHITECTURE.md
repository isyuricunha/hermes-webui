# Architecture

> Status: draft v0.1. This document reflects the PRD (section 42 onward) and the current implementation. It is refined by `docs/HERMES-CAPABILITY-MATRIX.md` as real Hermes API evidence lands.

## Shape

Hermes WebUI is a **local sidecar**: one Node/Fastify process that serves the built React assets and a private HTTP API, running on the same host as Hermes Agent. Restarting Hermes never takes the WebUI down, and vice versa.

```
Browser
  |  HTTP (same origin)
  v
WebUI server (Fastify, this repo)
  |- hermes/api-client    Hermes HTTP API adapter (single place that talks to Hermes)
  |- hermes/capability    capability negotiation across Hermes versions
  |- hermes/config        config/schema/env adapters (PRD 45.3, 45.4)
  |- hermes/cli           restricted CLI bridge (PRD 34, 50; allowlist, execFile only)
  |- actions              action registry: UI action -> API / config / CLI
  |- audit                mutation audit log (no secret values)
  v
Hermes Agent (gateway, sessions, runtime)   <- source of truth
```

The browser never talks to Hermes directly (PRD 47): auth, secrets, normalization, audit and the CLI bridge all live behind the WebUI backend.

## Foundry rules

1. **Hermes is the source of truth.** Sessions, messages, runs, config, credentials, models, MCP, skills, memory, cron and messaging belong to Hermes. The WebUI persists only presentation state (theme, pins, drafts, panel state) and its own audit log.
2. **API first, config second, CLI bridge last** (PRD 6.5). Every administrative action is registered with which level serves it; the capability matrix records the evidence.
3. **No invented endpoints.** The Hermes API client implements only endpoints confirmed by docs/HERMES-CAPABILITY-MATRIX.md (upstream source, official docs, or live probes).
4. **Normalized events.** Hermes-specific run events are normalized into the shared protocol (`packages/shared/src/protocol.ts`) before reaching React; raw payloads stay attached for debug views (PRD 48).
5. **The CLI bridge executes Hermes, not a shell.** `execFile`-style argv only, allowlist, typed argv, timeouts, output caps, redaction, audit, confirmation for mutations (PRD 50).

## Workspaces

| Path | Role |
|---|---|
| `apps/web` | React 19 + Vite + Tailwind + TanStack Query/Router. Chat-first shell, session sidebar, settings workspace, tool renderers. |
| `apps/server` | Fastify 5 + TypeBox. Static assets, `/api/*`, Hermes adapters, CLI bridge, audit. |
| `packages/shared` | Types and normalized event protocol shared by both apps. |

## Error model

Every non-2xx from the WebUI API returns:

```json
{ "error": { "code": "NOT_FOUND", "message": "human message" }, "requestId": "uuid" }
```

Messages are human-readable, technical detail is preserved in logs and details views, and credential-shaped fields are redacted from logs at the logger level (PRD 41, 59).

## Connection and restart model

The server probes the Hermes gateway (`HERMES_BASE_URL`) and reports connectivity (`/api/app/status`). When Hermes goes down (including intentional restarts driven through the UI), the WebUI stays up, flips to `restarting`/`offline`, retries with backoff, and restores the active view when Hermes returns (PRD 29.4, 40). Restart adapters are chosen by detected install mode (API, CLI, systemd unit) and never kill processes by PID as a primary strategy (PRD 54).

## Testing strategy

- Server: Fastify `inject()` against the real route tree (`apps/server/test`).
- Web: Vitest + jsdom + Testing Library (`apps/web/src/**/*.test.tsx`).
- E2E: Playwright against a Hermes mock and, for RC1, the real Hermes on this host (planned with Phase 2 chat).
