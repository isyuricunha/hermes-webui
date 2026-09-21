# Hermes WebUI

A modern, chat-first interface for Hermes Agent. It runs alongside your existing Hermes installation and gives you native chat, session management, structured tool activity, and full configuration/control from the browser.

> Status: **0.1.0-rc.1**. The product specification lives in [PRD.md](PRD.md). Hermes Agent remains the runtime and the single source of truth; this UI never duplicates sessions, runs, memory, cron, skills, MCP or configuration.

## Requirements

- Node.js 24+ with pnpm 12 (via `corepack enable`)
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
| `HERMES_API_KEY` | — | Gateway `API_SERVER_KEY` (server-side only) |
| `HERMES_BIN` | `hermes` | Hermes binary for the restricted CLI bridge |
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:49173` | Hermes dashboard API base URL (config/env/models/MCP/skills/ops) |
| `HERMES_DASHBOARD_SESSION_TOKEN` | — | Session token shared with the dashboard service (server-side only, never sent to the browser) |
| `WEB_DIST_DIR` | `../web/dist` | Built web assets served by the Fastify server |
| `HERMES_WEBUI_ALLOW_UPDATE_APPLY` | unset | Opt-in to run `hermes update` from the WebUI (deny-by-default; custom-patched installs must update through their own flow) |

See `apps/server/.env.example`. The WebUI keeps its own tiny configuration; Hermes settings stay in Hermes (`config.yaml` / `.env`) and are accessed through adapters.

## What works today

- **Chat-first home** with real Hermes sessions (list, create, rename, **fork**, delete), streaming responses over SSE, Markdown + code blocks, tool-call cards, interim commentary, stop, steer, inline approvals, per-session drafts, auto-scroll with jump-to-latest, run-error surfacing, double-submit guard, and reconnect after reload (status-polling fallback + late-completion recovery — the gateway SSE has no late-subscribe replay).
- **Status awareness**: Connected / Degraded / Offline pill driven by gateway health + capability checks.
- **Settings workspace**: **searchable by human label or dotpath** (type `nudge` or `memory.nudge_interval`) over the full Hermes config schema (864 fields), with a schema-driven field editor that deep-merges into the real config and confirms the change by re-reading it. Semantic navigation with **Models** (main model + provider readiness + main-slot switching), **MCP servers** (enable/disable + test), **Skills**, **Cron** (run/pause/resume/delete), **Messaging platforms**, **System** (status, **gateway restart with recovery detection**, per-file **logs** with allowlist, doctor, update review), **Raw Config** editor with pre-apply diff and dashboard-side YAML validation, and masked **Environment/secrets** management (set/remove with confirmation).
- **Restart-required banner** after config saves (PRD 30), with a direct link to the gateway restart.
- **Update safety**: update checks are read-only; applying is deny-by-default (`HERMES_WEBUI_ALLOW_UPDATE_APPLY=1` opt-in) because custom-patched installs must update through their own flow.
- **Cron**: job run/pause/resume/delete via the gateway API.
- **Command palette** (Ctrl/Cmd+K), dark/light/system theme, collapsible sidebar, mobile drawer.
- **Restricted CLI bridge** (Advanced > Hermes CLI): declared registry commands plus a read-only **exact-match** allowlisted escape hatch for the `hermes` binary. `execFile` only, no shell, shell-operator rejection, timeouts, output caps, credential redaction, audit logging — see [docs/SECURITY.md](docs/SECURITY.md).

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
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — technical architecture
- [docs/SECURITY.md](docs/SECURITY.md) — trust model, credential handling, CLI bridge controls
- [docs/HERMES-CAPABILITY-MATRIX.md](docs/HERMES-CAPABILITY-MATRIX.md) — API vs config vs CLI parity per Hermes capability
- [docs/INSTALLATION.md](docs/INSTALLATION.md) — full install guide (companion service, systemd unit)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — conventions, test strategy, adding capabilities
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — Hermes version requirements and known issues
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

[AGPL-3.0](LICENSE) © YC Inc.
