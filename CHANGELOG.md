# Changelog

All notable changes to Hermes WebUI are documented here.

## Post-RC1

### Added (full UI/UX pass)
- **Chat**: syntax-highlighted code blocks (YuTheme syntax colors, language header, copy), styled tables, message actions (copy, edit and resend, retry the last turn, read aloud through Hermes TTS, timestamps), a conversation header (rename, source, messages, tokens, cost, last activity) with pin, fork, export as Markdown or JSON, archive with undo and delete, prompt starters on new chats.
- **Attachments**: attach, drag and drop or paste images (downscaled client-side, sent as vision parts) and text/code files (inlined as fenced blocks); previews with remove; images show in your message bubble.
- **Voice**: dictation through the Hermes STT provider (`/api/audio/transcribe`), with recording and transcribing states.
- **Sidebar**: full-text search across every conversation with highlighted snippets, a Pinned group, grouping by last activity, inline rename (double-click or menu), per-conversation menu (pin, fork, archive with undo, delete).
- **Command palette** (Ctrl/Cmd+K): conversations, every settings page and actions, keyboard navigable. **Shortcuts**: Ctrl/Cmd+Shift+O new chat, Ctrl/Cmd+Shift+S sidebar, `/` focus, `?` help.
- **Settings, reorganized** (Assistant, Automation, Insights, App, Advanced) with new pages: **Usage** (tokens, cost, sessions and API calls over 7/30/90 days, daily chart, by model, top skills, conversations by source), **Profile & SOUL** (profiles, read and edit SOUL.md), **Tools** (toolsets with their tools and switches), **Memory** (providers, MEMORY/USER counts, curator pause), **Webhooks**, **Logs** (live tail with file, level and text filters). **System** now shows gateway, channel and host health (CPU, memory, disk, uptime). **Cron** gained status, next/last run and each job's run history linking to the run's conversation.
- **Installable app (PWA)**: manifest, icons and a service worker that caches only the app shell (never `/api`); background-run notifications and a title badge. Needs HTTPS.
- Toasts and in-app confirm/prompt dialogs replace `window.alert/confirm/prompt`; a friendly error screen replaces the router's default.
- Server: an allowlisted dashboard proxy (`/api/hx/*`) with safe path parameters, query-key filtering and download streaming; `/api/runs` accepts text plus image parts.

### Added
- **Sign in with your Hermes account** (`HERMES_WEBUI_AUTH_MODE=hermes`, the default): the WebUI verifies the Hermes dashboard's own username/password through `POST /auth/password-login`, never stores the password, and uses the dashboard session it receives (rotated via `/auth/native/refresh`) for Settings. `local` keeps the WebUI-owned Argon2id account.
- **YuTheme 2.0** across the app: AMOLED canvas by default (Graphite, Light and System remain), canonical accents with gold as the action color, Geist / Geist Mono, 0.5px hairlines with a 1px top highlight, and the named effect set (shimmer, border sheen, pulse, blur-in rise, skeleton), all off under reduced motion.
- **Chat redesign**: neutral user bubbles, full markdown styling (tables, lists, code blocks with copy), tool cards with per-tool icons and live status, a "Thinking…" state, an approval card with every choice the gateway offers, a single composer card that turns into a steer box while a run is active, a time-of-day greeting on new chats, and a sidebar grouped by Today / Yesterday / Previous 7 days / Older with the source of each conversation (Telegram, cron, WebUI).

### Fixed
- **Live run events were never rendered**: `EventSource` hands over the payload without its `data:` prefix and the frame parser dropped it, so tool cards, reasoning and approval requests only appeared (if at all) after the run finished. Approvals in particular could not be answered from the WebUI.
- `tool.completed` from `/v1/runs` carries no `tool_call_id`, reports `duration` in seconds and `error` as a boolean: cards now close by tool name, show the right duration and no longer print `[error] false`.
- A finished run's answer could render twice (stream completion plus the resume check); a failed run's error no longer disappears when history reloads.
- Persisted tool results show the real tool name (from the assistant's `tool_calls`) instead of "Tool result".
- A new chat appears in the sidebar as soon as its first message is sent.
- Removed a leftover `[csrf-debug]` console log on every mutation.
- **Native slash commands in Chat**: typing "/" opens a Hermes-derived command palette (118 registry commands) with filter-as-you-type, keyboard navigation and touch support. Recognized commands never reach the LLM as user text.
  - Native handlers: `/new`, `/model`, `/status`, `/sessions`, `/settings`, `/skills`, `/stop`, `/help`.
  - Unsupported registry commands render an explanatory system card instead of silently forwarding text.
- **Native model picker** (composer chip or `/model`): real provider -> model catalog, session-scoped lock only, global default explicitly delegated to Settings > Models. Prompt-identity labeling is unchanged.
- **Compact tool cards**: tool calls and persisted tool results render as collapsed cards (name, action summary, status, duration) with formatted, expandable detail (pretty JSON, normalized newlines). Reasoning renders as its own collapsible block, separate from tool output.
- **Human-readable session titles**: first meaningful user message becomes the display title (WebUI-side); raw `api_*` ids remain only in tooltips. Hermes-provided titles always win.
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
