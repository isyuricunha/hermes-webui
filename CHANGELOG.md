# Changelog

All notable changes to Hermes WebUI are documented here.

## Post-RC1

### Added
- **Top-level navigation is never a dead end**: Settings now exposes a clear path back to Chat everywhere.
  - Mobile: `←` back action in the Settings top bar (44px tap target, accessible label) and a Chat entry at the bottom of the Settings drawer; selecting it closes the drawer.
  - Desktop: Chat destination at the bottom of the Settings navigation column.
  - The Hermes WebUI brand in the mobile top bar is now a link back to Chat home.
  - Returning to Chat restores the last active session whenever one was visited (plain localStorage; normal browser Back/Forward and deep links are untouched).

## 0.1.0-rc.1 (RC1)

### Fixed (independent review findings)
- CLI bridge allowlist now requires **exact argv match** — prefix matching admitted mutating flags through the read-only escape hatch (`hermes doctor --fix` was reachable; now 403).
- Bridge child process runs with a controlled working directory (`$HOME`).
- Credential redaction expanded: Stripe `sk_live_`/`rk_live_`, `github_pat_`, `glpat-`, AWS `AKIA`, Google `AIza`, PEM key blocks, Slack `xox…`.
- Static-serving tests are build-order independent (CI regression caught by GitLab pipeline).
- MCP page: enable/disable and test wired to the dashboard API (was list-only).
- Models page: main model switching via provider/model selector (deep-merge through the dashboard, with expensive-model confirmation surfaced).
- Settings saves surface a restart-required banner; raw-config saves flag restart explicitly.
- Chat recovery: late `run.completed` (reconnect after the run finished) now renders the final answer; status polling surfaces the run's own error message; double-submit window on send closed.

### Deferred post-RC1 (by design, PRD 63 Beta scope)
- Plugins, bundles, profiles, webhooks, hooks, backups management (dashboard API ready; UI pending).
- Curated per-category config editors beyond the schema search + field editor.
- MCP add/remove server form (enable/disable/test shipped).
- Fallbacks/auxiliary slot editors (editable via Raw Config and search meanwhile).

## 0.1.0-alpha.0 (RC1 line, in progress)

### Added
- Chat-first home over real Hermes sessions: list/create/rename/delete/**fork**, streaming responses (SSE pass-through), Markdown + code blocks, tool-call cards, interim commentary, stop, steer, inline approvals, per-session drafts, auto-scroll with jump-to-latest, reload-surviving run registry.
- Settings workspace: search by human label or dotpath, schema-driven field editor with save-and-confirm against the live config, Raw Config editor (pre-apply diff, dashboard-side YAML validation), masked environment/secrets management, Models overview, MCP servers, Skills, Cron (run/pause/resume/delete), Messaging platforms.
- System page: gateway restart with recovery detection and status transitions, per-file log viewer (agent/gateway/errors), doctor runner, update check.
- Restricted Hermes CLI bridge (Advanced > Hermes CLI): declared command registry, read-only free-form allowlist, `execFile` only (no shell), shell-operator rejection, timeouts, output caps, credential redaction, execution audit logging.
- Update safety: update checks are read-only; applying an update is denied unless explicitly enabled (`HERMES_WEBUI_ALLOW_UPDATE_APPLY=1`), protecting custom-patched Hermes installs.
- Capability states: Connected / Degraded / Offline pill; settings areas degrade independently when the dashboard companion is down.
- Command palette (Ctrl/Cmd+K), dark/light/system theme, mobile drawer, resizable primary layout.

### Security
- Browser never talks to Hermes directly; gateway and dashboard credentials are server-side only.
- Logger redacts credential-shaped headers; bridge output passes credential-pattern scrubbing.
- CLI bridge: `execFile` only, fixed registry + read-only allowlist, timeouts, output caps, confirmation for mutations, no sudo, sanitized child environment.

### Documentation
- PRD (product authority), capability matrix against Hermes v0.21.3, architecture overview, security model, installation guide, development guide, compatibility notes.
