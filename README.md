# Hermes WebUI

A modern, chat-first interface for Hermes Agent. It runs alongside your existing Hermes installation and gives you native chat, session management, structured tool activity, and full configuration/control from the browser.

> Status: pre-release (working toward RC1). The product specification lives in [PRD.md](PRD.md). Hermes Agent remains the runtime and the single source of truth; this UI never duplicates sessions, runs, memory, cron, skills, MCP or configuration.

## Requirements

- Node.js 22+ (24 recommended) with pnpm 12 (via `corepack enable`)
- A running Hermes Agent gateway on the same host (default `http://127.0.0.1:8642`)

## Development

```bash
pnpm install
pnpm dev        # server on :8789 + web on :5173 with /api proxy
```

Open http://localhost:5173.

| Command | What it does |
|---|---|
| `pnpm dev` | Run server (tsx watch) and web (Vite) in parallel |
| `pnpm lint` | ESLint (flat config, whole repo) |
| `pnpm typecheck` | `tsc --noEmit` per workspace |
| `pnpm test` | Vitest suites (Fastify `inject()` for the server, jsdom + RTL for web) |
| `pnpm build` | Production build: Fastify server bundle + static web assets |

### Configuration (WebUI's own, env)

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address of the WebUI server |
| `PORT` | `8789` | Bind port of the WebUI server |
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Hermes gateway base URL |
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:49173` | Hermes dashboard API base URL (config/env/models/MCP/skills/ops) |
| `HERMES_DASHBOARD_SESSION_TOKEN` | — | Session token shared with the dashboard service (server-side only, never sent to the browser) |

See `apps/server/.env.example`. The WebUI keeps its own tiny configuration; Hermes settings stay in Hermes (`config.yaml` / `.env`) and are accessed through adapters.

## What works today

- **Chat-first home** with real Hermes sessions (list, create, rename, delete), streaming responses over SSE, Markdown + code blocks, tool-call cards, interim commentary, stop, steer, inline approvals, drafts and reconnect after reload.
- **Status awareness**: Connected / Degraded / Offline pill driven by gateway health + capability checks.
- **Settings workspace**: semantic navigation with Models (main model + provider readiness), MCP servers, Skills, Cron (run/pause/resume/delete), Messaging platforms, System (status, **gateway restart with recovery detection**, per-file **logs**, doctor, update review), **Raw Config** editor with pre-apply diff and dashboard-side YAML validation, and masked **Environment/secrets** management (set/remove with confirmation).
- **Update apply is deny-by-default**: the WebUI never runs `hermes update`; the check is read-only, and applying requires the operator to opt in (`HERMES_WEBUI_ALLOW_UPDATE_APPLY=1`) because custom-patched installs must update through their own flow.
- **Cron**: job list/create/update/delete/pause/resume/run via the gateway API.
- **Command palette** (Ctrl/Cmd+K), dark/light/system theme, mobile drawer.

## Repository layout

```
apps/web       React + TypeScript + Vite + Tailwind frontend (chat-first shell)
apps/server    Node + TypeScript + Fastify backend (API adapter, auth boundary, CLI bridge)
packages/shared  Shared types and the normalized event protocol
docs/          Architecture and compatibility documentation
PRD.md         Product requirements (authority for scope and UX)
```

## Documentation

- [PRD.md](PRD.md) — product requirements
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — technical architecture (draft, refined by the capability matrix)
- `docs/HERMES-CAPABILITY-MATRIX.md` — API vs config vs CLI parity per Hermes capability (in progress)

## License

[AGPL-3.0](LICENSE) © YC Inc.
