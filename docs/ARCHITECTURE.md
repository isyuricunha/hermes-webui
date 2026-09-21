# Architecture

> Status: draft v0.1. This document reflects the PRD (section 42 onward) and the current implementation. It is refined by `docs/HERMES-CAPABILITY-MATRIX.md` as real Hermes API evidence lands.

## Shape

Hermes WebUI is a **local sidecar**: one Node/Fastify process that serves the built React assets and a private HTTP API, running on the same host as Hermes Agent. Restarting Hermes never takes the WebUI down, and vice versa.

```
Browser
  |  HTTP (same origin)
  v
WebUI server (Fastify, this repo)
  |- hermes/client          gateway adapter: sessions/runs/SSE/cron/health/capabilities
  |- hermes/dashboard       dashboard adapter: config/schema/env/models/MCP/skills/ops
  |- hermes/errors          gateway error mapping (HERMES_AUTH_FAILED / HERMES_UNREACHABLE)
  |- cli/                   restricted CLI bridge (PRD 34, 50; exact-match allowlist, execFile only)
  |- routes/*               request-schema-validated proxies (/api/sessions, /api/runs, /api/cron, /api/settings/*, /api/cli/*)
  v
Hermes Agent (gateway + dashboard API, sessions, runtime)   <- source of truth
```

Roadmap components (designed, not yet built): capability negotiation layer, action registry, SQLite audit store, per-install-mode restart adapters.

The browser never talks to Hermes directly (PRD 47): auth, secrets, normalization and the CLI bridge all live behind the WebUI backend.

## Two upstream surfaces

The capability matrix (docs/HERMES-CAPABILITY-MATRIX.md) established that Hermes exposes admin capability on two HTTP surfaces, and the WebUI uses both:

| Surface | Transport | Auth | Used for |
|---|---|---|---|
| Gateway API server (`:8642`) | aiohttp + SSE, `Authorization: Bearer API_SERVER_KEY` | `API_SERVER_KEY` from Hermes `.env` | chat, sessions, runs, streaming, stop/steer/approvals, cron, health, capabilities |
| Dashboard API (`:49173`, loopback) | FastAPI, `X-Hermes-Session-Token` | shared session token (systemd drop-in) | config reads/writes + schema, env/secrets, models, MCP, skills, messaging, ops/doctor, update |

The dashboard runs as a companion service bound to loopback; the browser never
reaches it. When it is unavailable, chat keeps working and the settings areas
degrade to `HERMES_DASHBOARD_UNREACHABLE` errors instead of breaking the app.

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
| `apps/server` | Fastify 5 + JSON Schema validation. Static assets, `/api/*`, Hermes adapters, CLI bridge, structured logging. |
| `packages/shared` | Types and normalized event protocol shared by both apps. |

## Error model

Every non-2xx from the WebUI API returns:

```json
{ "error": { "code": "NOT_FOUND", "message": "human message" }, "requestId": "uuid" }
```

Messages are human-readable, technical detail is preserved in logs and details views, and credential-shaped fields are redacted from logs at the logger level (PRD 41, 59).

## Connection and restart model

The server probes the Hermes gateway (`HERMES_BASE_URL`) and reports connectivity (`/api/app/status`). Gateway restart is triggered through the dashboard API (`POST /api/gateway/restart`, which supervises the handoff); the WebUI stays up, keeps polling status, and reports recovery when the gateway answers again (PRD 29.4, 40). Restart adapters for other install modes (systemd direct, launchd) are roadmap.

## Testing strategy

- Server: Fastify `inject()` against the real route tree (`apps/server/test`).
- Web: Vitest + jsdom + Testing Library (`apps/web/src/**/*.test.tsx`).
- E2E: Playwright against a Hermes mock and, for RC1, the real Hermes on this host (planned with Phase 2 chat).
