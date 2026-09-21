# Changelog

All notable changes to Hermes WebUI are documented here.

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
