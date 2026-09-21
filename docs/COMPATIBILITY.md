# Compatibility

> Verified against **Hermes Agent v0.21.3 (2026.9.14, upstream 30de041b)** on a git install. The WebUI is developed against that exact version; other versions work through capability detection but are untested.

## Hermes requirements

| Requirement | Why |
|---|---|
| Gateway API server enabled (`API_SERVER_KEY` set) | chat, sessions, runs, streaming, cron, health. Without the key the WebUI reports `Degraded`. |
| `session_resources` capability | session create/rename/delete from the WebUI. Read-only listing works without it. |
| Dashboard companion (`hermes dashboard`) for Settings | config reads/writes + schema, env/secrets, models, MCP, skills, messaging, ops/doctor, update checks. Chat keeps working when it is down; Settings areas degrade to `HERMES_DASHBOARD_UNREACHABLE`. |
| `run_submission` + durable runs | send-message flow, stop, event streaming. |
| `admin_config_rw` on the dashboard | config/env writes. The gateway API never accepts config writes (capability reports `admin_config_rw: false`) — by design we use the dashboard API, not file editing. |

## Known Hermes behaviors we depend on

- Run SSE has **no late-subscribe replay**: on reconnect the WebUI polls run status and resubscribes. Terminal run statuses stay queryable for ~24h (durable idempotency store).
- There is **no run-history listing endpoint**: the WebUI keeps its own sessionId→runId registry in the browser.
- Session events and config writes are dashboard-only; chat and runs are gateway-only.

## Known issues on the reference host (not WebUI bugs)

- `GET /v1/skills` on the gateway returns `Failed to enumerate skills` on this install. The WebUI lists skills through the dashboard API instead.
- A GitHub account flag on the owner account blocks GitHub Actions and public visibility; CI therefore runs on GitLab (and YuGit once a runner is attached).

## Browser support

Evergreen Chromium/Firefox/Safari (ES2022 + EventSource). No polyfills are shipped.

## Version matrix

| WebUI | Tested Hermes | Notes |
|---|---|---|
| 0.1.0-rc.1 | 0.21.3 (2026.9.14) | reference version |
| older/newer Hermes | untested | capability detection hides missing features; report gaps as compatibility issues |
