# Security

> Status: current as of the CLI bridge milestone. Scope: the WebUI process, its boundary with Hermes, and the restricted CLI bridge.

## Trust model

Hermes WebUI is a **local sidecar** on the same host as Hermes Agent. It holds credentials for two upstream surfaces and exposes a single HTTP surface to the browser.

```
Browser  ──►  WebUI (Fastify)  ──►  Hermes gateway  (Bearer API_SERVER_KEY)
                               └─►  Hermes dashboard API (X-Hermes-Session-Token, loopback)
                               └─►  hermes binary (execFile, allowlisted argv)
```

Rules that hold everywhere:

- **The browser never talks to Hermes directly** (PRD 47). Credentials stay server-side; no token is ever sent to the client.
- **The dashboard API is internal.** It is bound to loopback and treated as an admin backend, never as a UI the user visits.
- **Hermes owns state.** The WebUI persists only presentation data (theme, drafts, active-run registry) in the browser.

## Credentials

| Secret | Where it lives | Used for |
|---|---|---|
| `HERMES_API_KEY` | WebUI server env / `.env` (0600) | `Authorization: Bearer` to the gateway |
| `HERMES_DASHBOARD_SESSION_TOKEN` | WebUI server env + dashboard service env | `X-Hermes-Session-Token` to the dashboard API |

Neither value is logged: the Fastify logger redacts `authorization`, `cookie` and `x-hermes-session-token`. Environment values surfaced in Settings come back **masked from Hermes** and are never unmasked by the WebUI.

## CLI bridge (PRD 34-36, 50)

The bridge exists to reach Hermes capabilities that have no HTTP API. It is **not** a terminal.

Controls, all enforced server-side:

1. **`execFile` only, never `shell: true`.** Argv is an array; no string is ever handed to a shell.
2. **Two entry points, both closed:**
   - registry commands (`apps/server/src/cli/registry.ts`) with fixed argv declared in code;
   - the Advanced escape hatch, where free-form text must (a) contain no shell operator (`; | & < > ( ) $ \` && ||`), (b) start with `hermes`, and (c) match a read-only allowlist entry **exactly** (same command, same arity — extra flags like `--fix` are refused).
3. **Mutating commands require `{ confirm: true }`** and are logged at warn level with an audit line (`action: cli.run`).
4. **`hermes update` can never run through the bridge**: it is not in the registry and not on the allowlist. The dedicated update-apply route is additionally deny-by-default (`HERMES_WEBUI_ALLOW_UPDATE_APPLY=1` to opt in) because a custom-patched install must update through its own flow.
5. **Timeouts and output caps**: each command declares `timeoutMs` and `maxOutputBytes`; truncation is reported to the UI instead of being hidden.
6. **Redaction**: stdout/stderr pass through credential-pattern scrubbing (`sk-…`, `sk_live_…`, `github_pat_…`, `glpat-…`, `AKIA…`, `AIza…`, `xox…`, `Bearer …`, PEM key blocks, `api_key=…`) before leaving the server; the response flags `redacted: true`. Pattern coverage is best-effort — unknown secret shapes are not caught.
7. **Sanitized child environment**: only `PATH`, `HOME`, `LANG`, `TERM`, `USER`, `SHELL` are passed to the child, with a controlled working directory (`$HOME`). No credential variables are inherited.
8. **No sudo, no privilege escalation.** The bridge runs as the WebUI process user.

Verified live against the real Hermes install: allowed commands execute (`hermes lsp status`, `hermes gateway status`), while `hermes update` (403 `NOT_ALLOWLISTED`), `hermes status; rm -rf /` (400 `SHELL_OPERATOR_FORBIDDEN`), `hermes status $(id)` (400) and `curl …` (400 `HERMES_BINARY_ONLY`) are all refused.

## Network exposure

- Default bind is `127.0.0.1` for both the WebUI and the dashboard companion.
- Binding the WebUI to a LAN/VPN address is an operator decision. All `/api/*` routes are deny-by-default behind a server-side cookie session with CSRF on mutations and login rate limiting (PRD 49); sign-in is delegated to the Hermes dashboard's password provider (`HERMES_WEBUI_AUTH_MODE=hermes`, default) or a local Argon2id account (`local`).
- In `hermes` mode the dashboard session obtained at sign-in (access + refresh token) is stored server-side in the WebUI database (0600) and sent as `Authorization: Bearer` to the dashboard; it never reaches the browser, and the password is never stored.

## Destructive actions

Actions that change Hermes state require explicit confirmation in the UI and are logged:

- gateway restart (warns, then polls for recovery);
- environment variable removal;
- cron job delete;
- session delete;
- raw config save (shown as a diff before applying, validated by Hermes).

## Reporting

This project targets a single-operator, self-hosted deployment. Report issues through the repository that hosts it.
