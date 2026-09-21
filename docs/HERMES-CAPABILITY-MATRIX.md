# Hermes Agent Capability Matrix — WebUI RC1 (draft)

Reference host: Linux · Hermes v0.21.3 (2026.9.14, upstream 30de041b, git install) · verified 2026-09-20 (America/Sao_Paulo).

## The one thing to internalize first: there are THREE API surfaces, not one

| Surface | Transport | Process on this host | State |
|---|---|---|---|
| **Gateway API server** (`gateway/platforms/api_server.py`) — OpenAI-compatible + `/v1/runs` + `/api/sessions` + `/api/jobs` + `/health*` | aiohttp HTTP + SSE, Bearer `API_SERVER_KEY` | **RUNNING** inside `hermes-gateway.service` on `127.0.0.1:8642` | **live-verified** |
| **Dashboard web server** (`hermes_cli/web_server.py` + `hermes_cli/web_routers/*`, FastAPI, ~150 routes) | HTTP + WebSocket, session-token / OAuth-cookie auth | `hermes-dashboard.service` unit exists (`0.0.0.0:49173`) but **inactive**; CLI default port 9119 | source-read; endpoints 404/absent on 8642 (verified: `/api/health`→404, `/api/config/schema`→404) |
| **tui_gateway JSON-RPC** (`tui_gateway/`) — desktop/TUI backend: session lifecycle, prompt, approvals, events with per-session `seq` + replay | stdio (TUI) or WebSocket `/api/ws` on the dashboard | embedded in gateway process + spawned `hermes --tui` children | source-read |

Legend: **V** = verified-live (probe output in SPIKES-findings.md) · **S** = source-read with file:line at commit 30de041b · **D** = doc-read · **A** = assumption/inference. Read-only/M / Confirm / Restart / PTY columns: `—` = no.

## 1. Sessions & runs

| Capability | API (endpoint, method) | Config keys | CLI | R/O-M | Confirm | Restart | PTY | Evidence | Conf | Notes for WebUI |
|---|---|---|---|---|---|---|---|---|---|---|
| List sessions (API server) | `GET /api/sessions` (query `limit`,`offset`,`include_disabled` n/a) | — | `hermes cron status` (indirect) | R/O | — | — | — | api_server.py:1591; live probe V | V | Rows: id, source, user_id, model, title, message/tool/token/cost counts, preview, pinned/archived/hidden. `source` = platform origin (`api_server`, `telegram`, …). |
| Create session | `POST /api/sessions` | — | — | M | — | — | — | api_server.py:1592, 2368 ("404 disabled, 403 no API key, 401 bad Bearer, 201") | S | Gated by features flag `session_resources: true` (V via `/v1/capabilities`). |
| Get / patch / delete session | `GET|PATCH|DELETE /api/sessions/{id}` | — | — | GET R/O; PATCH/DEL M | — | — | — | api_server.py:1593–1596 | S | |
| Messages | `GET /api/sessions/{id}/messages` | — | — | R/O | — | — | — | api_server.py:1596; live shape V | V | Private content — WebUI must render locally only. |
| Fork / model-lock | `POST /api/sessions/{id}/fork`, `POST /api/sessions/{id}/model` | — | — | M | — | — | — | api_server.py:1597,1600 | S | |
| Chat (blocking / SSE) | `POST /api/sessions/{id}/chat`, `POST /api/sessions/{id}/chat/stream` (SSE) | continuity: `X-Hermes-Session-Id`, conversation: `X-Hermes-Session-Key` headers | — | M (creates a turn) | — | — | — | api_server.py:1598–1599, 3219–3325 (`text/event-stream`, `_sse_frame` at 243) | S | Streaming response uses `event:`+`data:` frames, keepalive via `CHAT_COMPLETIONS_SSE_KEEPALIVE_SECONDS`. |
| OpenAI-compatible endpoints | `POST /v1/chat/completions`, `POST /v1/responses`, `GET/DELETE /v1/responses/{id}`, `GET /v1/models` | — | — | M (turn) / R/O | — | — | — | api_server.py:1601–1605; live `/v1/models` V | V | Single virtual model `hermes-agent`; real routing via body `model`/`provider` overrides. |
| **Durable runs** | `POST /v1/runs` (`Idempotency-Key` header, body `input` (str or msg list), optional `session_id`, `model`, `previous_response_id`) → `run_id` | — | — | M | — | — | — | api_server_runs.py:142, 499–560; capabilities `run_submission: true`, `runs_idempotency {durable, retention_seconds: 86400}` (V) | V/S | **The primary WebUI run submission path.** Idempotency fingerprint = sha256(body+session_key) scoped per client. |
| Run status (poll) | `GET /v1/runs/{run_id}` | — | — | R/O | — | — | — | api_server_runs.py:142; `_run_statuses` pollable, TERMINAL_STATUSES import | S | Status survives in durable idempotency store 24h — reconnect path. |
| Run history listing | — none on HTTP (only per-run status) | — | — | — | — | — | — | — | — | Gap: no `GET /v1/runs` list; WebUI must track its own run registry or poll sessions. |
| Dashboard session store (rich) | `GET /api/sessions` (limit≤100, offset, order=created\|recent, archived=exclude\|only\|include, source(s), exclude_sources, cwd_prefix, full), `GET /api/sessions/search`, `GET /api/sessions/stats`, `GET /api/sessions/{id}`, `/{id}/messages` (paged ≤500, order=latest), `/{id}/timeline`, `/{id}/messages/around`, `/{id}/latest-descendant`, `/{id}/export`, `PATCH /api/sessions/{id}`, `DELETE /api/sessions/{id}`, `POST /api/sessions/bulk-delete`, `DELETE /api/sessions/empty`, `GET /api/sessions/empty/count`, `POST /api/sessions/import`, `POST /api/sessions/prune`, `POST /api/sessions/owner-backfill` | — | — | GET R/O; rest M | delete ops | — | — | web_routers/sessions.py:165,254,395,412,435,443,460,479,495,531,585,607,629,644,683,720,755 | S | Much richer than API-server sessions. Requires the dashboard server running. |

## 2. Streaming / events

| Capability | API | Config keys | CLI | R/O-M | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|---|
| Run event stream (HTTP) | `GET /v1/runs/{run_id}/events` — SSE (`text/event-stream`), `: keepalive` comments | — | — | R/O | api_server_runs.py:143, 888–929 | S | Queue-per-run; **no Last-Event-ID replay** — reconnect = re-poll status + resubscribe (see §8). |
| Run SSE event names | `message.delta {delta}`, `message.interim {text, already_streamed}`, `tool.started {tool, preview}`, `tool.completed {tool, duration, error, preview≤500 chars secret-redacted}`, `reasoning.available {text}`, `subagent.start|subagent.complete` (+15 forwarded fields), `approval.request {choices, command-redacted…}`, `approval.responded`, `run.stopping`, `run.steered`, terminal `run.completed|run.failed|run.cancelled|run.interrupted` (+`usage`, `runtime`, `pending_steer`) | — | — | R/O | api_server_runs.py:38–60 (`_FIXED_EVENT_FIELDS`), 199–227, 733–778, 790–820 | S | `_thinking`/`subagent.tool`/`subagent_progress` deliberately dropped as UI noise (api_server_runs.py:212). |
| Desktop event frames (WS `/api/ws`) | JSON-RPC `event` frames; ~63 typed payloads (contracts/events.py): `gateway.ready` (skin, `replay_epoch`), `message.start/delta/complete/interim`, `thinking.delta`, `reasoning.delta/available`, `tool.start/generating/complete/output_risk`, `todo.updated`, `status.update`, `session.info/usage/title/resume_progress/control.update/reclaimed`, `notification.*`, `moa.*`, `connection.request/update`, `cron.changed`, `sessions.changed`, `platforms.changed`, `pairing.changed`, `error`, `notice`, … | — | — | R/O | tui_gateway/contracts/events.py:1–120 + `^event(` registry (63 names enumerated) | S | Typed by pydantic Payload models — the authoritative event schema lives in this file. |
| Broadcast fan-out (dashboard) | WS `/api/pub` (publish) + `/api/events?channel=` (subscribe) | — | — | R/O | web_routers/chat_ws.py:607–639 | S | The PTY-side tui_gateway mirrors every emit to `/api/pub`; dashboard fans out per channel. |
| Dashboard WS chat | WS `/api/ws` → `tui_gateway.ws.handle_ws` (JSON-RPC) | — | — | M (drives turns) | chat_ws.py:573–586 | S | Same surface Ink uses over stdio; binds to same session id. |

## 3. Tool calls (representation, lifecycle)

| Capability | API | Evidence | Conf | Notes |
|---|---|---|---|---|
| Tool lifecycle events (runs SSE) | `tool.started {tool, preview}` → `tool.completed {tool, duration, error, preview}` ; failures surface via `subagent.start/complete` boundaries + terminal `run.failed` | api_server_runs.py:46–49, 210–227 | S | Preview is secret-redacted *before* truncation (`_tool_completed_preview`, api_server_runs.py:52–60). |
| Tool lifecycle events (desktop WS) | `tool.start`, `tool.generating`, `tool.complete`, `tool.output_risk` | events.py registry | S | Richer than runs SSE. |
| Historical tool calls | session messages (dashboard `GET /api/sessions/{id}/messages`) carry tool rows; API-server messages endpoint too | sessions.py:531–573 (`_project_for_display`) | S | Tool call count per session in list rows (`tool_call_count`, V in probe). |
| Toolsets | API server `GET /v1/toolsets` (V: web, browser, … with enabled/configured/tools[]) ; dashboard `GET /api/tools/toolsets`, `PUT /api/tools/toolsets/{name}`, `.../config`, `.../models`, `PUT .../model`, `PUT .../provider`, `PUT .../env`, `POST .../post-setup`, `GET /api/tools/terminal/backends`, `PUT /api/tools/terminal/backend`, `GET /api/tools/computer-use/status`, `POST /api/tools/computer-use/permissions/grant` | tools.py:230–692; live V | V/S | Dashboard toolset PUTs are M, config-write. |

## 4. Commentary / progress events

| Capability | API | Evidence | Conf | Notes |
|---|---|---|---|---|
| Mid-turn assistant commentary | runs SSE `message.interim {text, already_streamed}`; desktop `message.interim` | api_server_runs.py:755–765 ("Codex `phase=\"commentary\"`, text beside tool calls"); events.py | S | Explicitly NOT reasoning; final answer still arrives via `run.completed`. |
| Reasoning | runs SSE `reasoning.available {text}`; desktop adds `reasoning.delta`, `thinking.delta` | api_server_runs.py:50; events.py:96–104 | S | Config `agent.show_reasoning: true` here. |
| Status/progress text | desktop `status.update {kind, text}` | server.py:795 | S | No runs-SSE equivalent. |

## 5. Stop

| Capability | API | CLI | R/O-M | Confirm | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|---|
| Stop a run (HTTP) | `POST /v1/runs/{run_id}/stop` → `{"run_id","status":"stopping"}` then SSE `run.cancelled`/terminal status | — | M | — | api_server_runs.py:146, 1029–1057 | S | Hard provider interrupt + background-process reap scoped to the run; idempotent (terminal status returned as-is). |
| Interrupt a session (desktop) | RPC `session.interrupt` (params `session_id`, optional `expected_hosted_task_id`) → `{status: interrupted|not_interrupted}` | — | M | — | methods_session.py:2048–2078 | S | Also silences TTS, retires crash-recovery marker so resume won't auto-continue. |
| Busy-input behavior | config `display.busy_input_mode`: `queue` \| `steer` \| `interrupt` (default `interrupt`) | `display.busy_input_mode` | — | — | server.py:329–333 | S | What a client's Enter-during-run does by default. |

## 6. Steer (mid-run steering)

| Capability | API | Evidence | Conf | Notes |
|---|---|---|---|---|
| Steer a run (HTTP) | `POST /v1/runs/{run_id}/steer` body `{input|message|text}` → 200 `{object:"hermes.run.steer", accepted:true}`; 409 `run_not_accepting_steer` / `steer_not_accepted`; emits `run.steered` | api_server_runs.py:145, 995–1027 | S | Requires run status `running` and agent with `.steer`. |
| Steer (desktop RPC) | `session.steer` → agent.steer(text) (`{status: queued|rejected}`); `session.redirect` (active-turn redirect, capability-gated); `subagent.steer {subagent_id, text}` (queues into delegated child; may surface `missed_steer`) | methods_session.py:2098–2127, 2145–2161 | S | Undelivered steer rides terminal events as `pending_steer` (api_server_runs.py:104–108). |
| `prompt.submit` while busy | Same RPC used to send; while `running` it either 4009 `session busy` (rewind params) or queues/steers per busy-input flow | methods_prompt.py:564–650 | S | |

## 7. Approvals

| Capability | API | Config keys | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|
| Approval request (client← server) | runs SSE event `approval.request` (command redacted via `_redact_approval_command`; `choices` = smart_denied/allow_session/allow_permanent flags); run status flips to `waiting_for_approval`. Desktop: JSON-RPC **server→client request** `approval` + events `approval.pending`/`approval.received` | `approvals.mode`, `approvals.timeout` | `hermes approvals` (mine history → allowlist proposals) | api_server_runs.py:706–737; server.py:697–781, 1717–1720 | S | Redaction happens before the wire (credential-shaped values never leave the process). |
| Resolve approval (HTTP) | `POST /v1/runs/{run_id}/approval` body `{choice: once|session|always|deny, request_id?, all?}` → `{object:"hermes.run.approval_response", resolved:N}`; 409 `approval_not_pending` / `approval_not_active`; emits `approval.responded` | | | api_server_runs.py:944–992 | S | `once/session/always/deny`; `all` = resolve coalesced duplicates. |
| Resolve (desktop RPC) | `approval.respond` | | | server.py:750–781 (`register_gateway_settle`) | S | |
| Pending approval read-back | `get_pending_gateway_approval(session_key)` (oldest unresolved per session) | | | server.py:739–747 | S | For crash recovery UI: poll `GET /v1/runs/{id}` → status `waiting_for_approval` + `approval` field. |

## 8. Reconnect (reattachment, replay)

| Capability | API | Evidence | Conf | Notes |
|---|---|---|---|---|
| Runs API reconnect | Re-`GET /v1/runs/{id}` (status durable 24h) + re-open `/events` (queue only — buffered while no subscriber? No: `_run_streams` queue buffers per run until TTL sweep `_RUN_STREAM_TTL`; SSE writes only go to *connected* subscribers, but the queue retains events until someone drains or TTL) | api_server_runs.py:888–929, 1059–1077 | S | **Needs live mutation test** to confirm backfill-on-late-subscribe behavior. Safe WebUI design: on reconnect, poll status first, then resubscribe SSE; treat missed events as lost (terminal event still delivered). |
| Desktop WS reconnect | `session.events.since {session_id, seq}` replays per-session ring (≤512 events / 4 MiB, FIFO eviction + truncation watermark); `replay_epoch` in `gateway.ready` detects backend restart (epoch change ⇒ reset watermarks); `session.events.stats` | event_replay.py:1–70; methods_session.py:2244, 2261 | S | Best-in-class replay — but only over the dashboard `/api/ws`. |
| PTY reattach (dashboard chat tab) | `/api/pty?attach=<token>&resume=<session>&channel=<ch>` — PTY outlives socket, ring-buffered while detached, child EOF ⇒ close 4410 | chat_ws.py:491–564 | S | For an xterm.js embedded terminal option. |
| Session continuity headers | `X-Hermes-Session-Id` (addresses session) / `X-Hermes-Session-Key` (names conversation across compression rotation) | api_server.py:1653–1690; capabilities `session_continuity_header` (V) | V/S | |

## 9. Config API

| Capability | API | CLI | R/O-M | Restart | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|---|
| Read config | `GET /api/config?profile=&include_defaults=` (dashboard) | `hermes config show|get|path` | R/O | — | config_env.py:78–90; CLI V | S/V | Strips `_`-internal keys. |
| Defaults + schema (public, no auth) | `GET /api/config/defaults` → DEFAULT_CONFIG; `GET /api/config/schema` → `{fields, category_order}` | — | R/O | — | config_env.py:92–105; public_paths.py:19–21 | S | 404 on the gateway api_server (V) — dashboard only. |
| Write config | `PUT /api/config` body `{config, profile?, preserve_language?}` — **deep-merge** over disk, per-schema-driven form; approves-mode change broadcasts session.info | `hermes config set|unset|edit|migrate|check` | M | mostly no (per-turn config reads); see SPIKES B | config_env.py:114–160 | S | No PATCH — merge semantics inside PUT. |
| Raw YAML | `GET /api/config/raw`, `PUT /api/config/raw` (dashboard) | `hermes config edit` | M | — | web_routers/analytics.py:33,52 | S | Raw YAML escape hatch. |
| API server equivalent | **none** — `/v1/capabilities` reports `admin_config_rw: false` (V) | — | — | — | api_server.py:73; live V | V | WebUI must run the dashboard server (or edit files) for config. |

## 10. .env / credentials

| Capability | API | CLI | R/O-M | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|
| List env keys | `GET /api/env` (dashboard; masked) | `hermes config env-path` | R/O | config_env.py:226 | S | Never expose values; masked by default. |
| Write/delete keys | `PUT /api/env`, `DELETE /api/env` | — | M | config_env.py:286, 942 | S | |
| Reveal one value | `POST /api/env/reveal` | — | M, gated | config_env.py:960 | S | Gate carefully in WebUI (confirm dialog + audit). |
| Provider OAuth | `GET /api/providers/oauth`, `POST .../oauth/{provider}/start|submit`, `GET .../poll/{session_id}`, `DELETE ...` | `hermes logout`, `hermes auth`, `hermes portal` | M | web_routers/oauth.py:619–775 | S | Device-code + polling flow. |
| Custom endpoints | `GET|POST /api/providers/custom-endpoints`, `POST .../{id}/activate`, `DELETE .../{id}`, `POST .../validate`, `POST /api/providers/validate` | — | M | config_env.py:650–940 | S | |
| Credentials pool | `GET|POST /api/credentials/pool`, `DELETE /api/credentials/pool/{provider}/{index}` | `hermes auth` (pooled creds) | M | ops.py:303–387; config `credential_pool_strategies` (V in config.yaml) | S | |
| Vault (desktop RPC) | `vault.list/add/remove/lock/unlock/sources/source.set` | — | M | tui_gateway methods registry | S | |
| API-server key | `API_SERVER_KEY` in `~/.hermes/.env` (present V, value never read into reports) | — | — | api_server.py:1176, 1398–1432 | V/S | Bearer auth for everything on 8642. |

## 11. Gateway lifecycle

| Capability | API | CLI | R/O-M | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|
| Status | `GET /health`, `GET /health/detailed` (Bearer), `GET /v1/health`; dashboard `GET /api/status` (public) | `hermes gateway status` (V), `hermes status` (V) | R/O | api_server.py:1576–1579, 2257; gateway.py | V/S | `/health/detailed` includes per-platform state map (telegram/discord/whatsapp/matrix/api_server/email…) with `state`, `error_code`, `needs_attention`. |
| Start/stop/restart | dashboard `POST /api/gateway/start`, `/api/gateway/stop`, `/api/gateway/restart` (spawns `hermes gateway restart` detached, returns pid) | `hermes gateway start|stop|restart|run|install|uninstall` | M | actions.py:138–143; ops.py:251–264; CLI V | S/V | Restart hands ownership to systemd via exit code 75 (`RestartForceExitStatus=75`, unit file V). |
| Migrate / drain | `GET /api/gateway/migrate/plan`, `POST /api/gateway/migrate`, `POST /api/gateway/drain {action}` | `hermes gateway migrate|migrate-legacy` | M | actions.py:146–175 | S | |
| Enroll relay | — | `hermes gateway enroll` | M (writes .env) | `hermes gateway --help` (V) | V | |

## 12. Restart mechanics on this host

Reference host supervisor: a systemd user unit (Restart=always, dedicated restart exit code); exact unit name and paths are host-specific — detect install mode via the update API (install_method) and service manager at runtime. Safe WebUI paths: `hermes gateway restart` (spawns + supervises) or `systemctl --user restart hermes-gateway`. `hermes update` restarts the gateway itself unless `--no-gateway-restart`.

## 13. Health endpoints

| Capability | API | Evidence | Conf |
|---|---|---|---|
| Shallow (public, unauthenticated) | `GET /health` → `{"status":"ok","platform":"hermes-agent","version":"0.21.3"}` | live V | V |
| Detailed (Bearer) | `GET /health/detailed` → readiness checks (`state_db`, `session_store`, `config`, `model`, `disk {used_percent, free_bytes}`, `gateway {state, connected_platforms, platforms}`, `background_queues {active_api_runs, active_delegations}`) + full per-platform map | live V; api_server.py:2257 | V |
| Dashboard | `GET /api/health` (public), `GET /api/health/idle`, `POST /api/health/retirement`, `GET /api/status` (public: version, gateway state, session count, auth shape) | status.py:114,121,129,433; public_paths.py | S |
| Capabilities discovery | `GET /v1/capabilities` (Bearer) → machine-readable feature flag object | live V | V |

## 14. MCP

| Capability | API | CLI | Config | Evidence | Conf |
|---|---|---|---|---|---|
| List/config servers | dashboard `GET|POST|PUT /api/mcp/servers`, `DELETE /api/mcp/servers/{name}`, `POST .../{name}/test`, `POST .../{name}/auth`, `PUT .../{name}/enabled`, `GET /api/mcp/catalog`, `POST /api/mcp/catalog/install`, OAuth flow endpoints | `hermes mcp list|add|remove|test|configure|login|reauth|picker|catalog|install|serve` | **`~/.hermes/config.yaml` → `mcp_servers:`** (V: `context7: {url, enabled, headers}`, `cloudflare: {url, auth: oauth, enabled, tools.exclude[]}`) | web_routers/mcp.py:94–443; config.yaml:1032 V; docs: /docs/reference/mcp-config-reference | V/S |
| Restart-required? | MCP servers are (re)connected per agent build; `tools.mcp_tool_lifecycle.shutdown_mcp_servers` exists (hermes_cli/main.py:113) — config edits likely picked up on next turn/session; **needs mutation test** | — | — | — | A |

## 15. Skills

| Capability | API | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|
| List/read/write local | dashboard `GET /api/skills`, `PUT /api/skills/toggle`, `GET|PUT /api/skills/content`, `POST /api/skills` | `hermes skills list|inspect|config|trust|untrust…` | skills.py:343–427 | S | |
| Hub | `POST /api/skills/hub/install|uninstall|update`, `GET /api/skills/hub/official|sources|search|preview|scan` | `hermes skills search|browse|install|check|update|audit|uninstall|publish` | skills.py:97–265 | S | Installs are M + confirmation-worthy (supply chain: `hermes security` audit exists). |
| API server | `GET /v1/skills` | — | api_server.py:1584; live probe returned `{"error":{"message":"Failed to enumerate skills"}}` | V | Live anomaly on this host — investigate profile scoping before relying on it. |

## 16. Cron

| Capability | API | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|
| Jobs CRUD + trigger | **API server** `GET|POST /api/jobs`, `GET|PATCH|DELETE /api/jobs/{id}`, `POST /api/jobs/{id}/pause|resume|run` (Bearer) | `hermes cron list|create|edit|pause|resume|run|remove|status|runs|history|incidents|doctor|tick` | api_server.py:1608–1618, 3447–3570; live `GET /api/jobs` V; `hermes cron status` V | V/S | Schedule format: `{"kind":"cron","expr":"10 10 * * *","display":…}` (V). Prompt length cap + injection scan on write (`_validate_cron_prompt`). |
| Dashboard cron surface | `GET /api/cron/jobs[/{id}[/runs]]`, `POST|PUT|DELETE /api/cron/jobs…`, pause/resume/trigger, `GET /api/cron/delivery-targets`, `GET /api/cron/blueprints`, `POST /api/cron/blueprints/instantiate`, `POST /api/cron/fire` (JWT-authed webhook) | — | web_routers/cron.py:211–392 | S | |
| Note | `/v1/capabilities` says `jobs_admin: false` yet `/api/jobs` works behind Bearer — the flag appears to describe a different admin tier; treat `/api/jobs` as available (V) | | | | V |

## 17. Models / providers / fallbacks / auxiliary

| Capability | API | CLI | Config keys | Evidence | Conf | Notes |
|---|---|---|---|---|---|---|
| Provider/model catalog | dashboard `GET /api/model/info` (public), `GET /api/model/options` (also on API server, V), `GET /api/model/recommended-default` | `hermes model`, `hermes moa` | `model.default`, `model.provider`, `providers.<slug>.*`, `model.aliases` | models.py:53–170; config.yaml V; live `/api/model/options` V | V/S | Options response: per-provider `slug, is_current, authenticated, key_env, warning, models[]`. |
| Set default | dashboard `POST /api/model/set` | `hermes model` (interactive picker — PTY) | `model.default/provider` | models.py:272 | S | |
| Fallbacks | — (config only) | `hermes fallback` | `fallback_providers:` | `hermes --help` V; config.yaml V | V | |
| Auxiliary / MoA | dashboard `GET /api/model/auxiliary`, `GET|PUT /api/model/moa` | `hermes moa` | moa slots | models.py:173–270 | S | |
| Routing per request | `POST /v1/runs`/`/v1/chat/completions` body `model`/`provider` (+`model_routes` route resolution, `route_source` in runtime metadata) | — | `model_routes` | api_server_runs.py:543–556, 812–820 | S | |

## 18. Messaging channels

| Capability | API | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|
| Channel status (live) | `GET /health/detailed` → `platforms.{telegram,email,discord,api_server,whatsapp,matrix,…}` with `state: connected|fatal|retrying`, `error_code/message`, `needs_attention` | `hermes gateway status` | live V | V | Observed: telegram connected; discord fatal (bad token); whatsapp retrying; matrix … — per-channel health without any dashboard. |
| Per-channel config | dashboard `GET /api/messaging/platforms`, `PUT /api/messaging/platforms/{platform_id}`, `POST .../{platform_id}/test`; onboarding: `POST|GET|DELETE /api/messaging/{whatsapp,telegram}/onboarding/…` | `hermes gateway setup`, `hermes whatsapp`, `hermes whatsapp-cloud`, `hermes slack`, `hermes send`, `hermes pairing` | web_routers/messaging.py:549–916 | S | Config ultimately in config.yaml + .env (`DISCORD_BOT_TOKEN` etc. — key names V in .env). |
| Channel changes require gateway restart | yes for enable/disable platform listeners | | gateway config; platform list `SHARED_LISTENER_MIRROR_PLATFORMS` (gateway/config.py:250–261) | S/A | |

## 19. LSP

| Capability | API | CLI | Evidence | Conf |
|---|---|---|---|---|
| Status / list / install / restart | none (no HTTP) | `hermes lsp status|list|install|install-all|restart|which` | CLI V (enabled, wait_mode document, pyright+typescript+vue installed) | V |
| Servers on disk | `~/.hermes/lsp/` (node-based servers, seen in gateway cgroup V) | | ps/systemd-cgroup V | V |

## 20. Doctor / diagnostics

| Capability | API | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|
| Doctor | dashboard `POST /api/ops/doctor` | `hermes doctor [--fix] [--live] [--ack ID]` | ops.py:503; CLI V | S/V | `--fix` mutates; `--live` makes network calls; plain run is read-only. |
| Security audit | `POST /api/ops/security-audit` | `hermes security` | ops.py:508 | S | |
| Backup/import | `POST /api/ops/backup`, `GET /api/ops/backup/download`, `POST /api/ops/import|-upload` | `hermes backup|import|dump|debug` | ops.py:520–582 | S | |
| Logs | dashboard `GET /api/logs` (logs_router) | `hermes logs`, `hermes logs errors`, `hermes logs -f` (PTY for -f) | status.py:765 | S | Files: `~/.hermes/logs/{agent,gateway,errors}.log` (V on disk). |
| Hooks/checkpoints/curator | `GET|POST|DELETE /api/ops/hooks`, `GET /api/ops/checkpoints`, `POST /api/ops/checkpoints/prune`, `GET /api/curator`, `PUT /api/curator/paused`, `POST /api/curator/run`, learning graph endpoints, `POST /api/ops/prompt-size|dump|config-migrate|debug-share` | `hermes hooks|checkpoints|curator|journey` | ops.py:605–761; status.py:590–744 | S | |

## 21. Update flow

| Capability | API | CLI | Evidence | Conf | Notes |
|---|---|---|---|---|---|
| Check | dashboard `GET /api/hermes/update/check` → `{install_method, current_version, behind, update_available, can_apply, update_command, message, commits[]}` | `hermes update --check` (also `--plan`) | actions.py:257–268; CLI V (`hermes --version` says "Up to date", install method: git) | S/V | Install-mode detection = `install_method` field (apt\|git\|docker\|nix\|nixos\|unknown); `can_apply` true only for git. |
| Apply | dashboard `POST /api/hermes/update` (background spawn, admission gate `evaluate_update_admission`, refusal receipts; honors external-management flag → `dashboard_update_managed_externally`) | `hermes update [--yes] [--no-gateway-restart]` | actions.py:218–255 | S | Mutating + restarts gateway by default. Docker/apt installs are refused in-place. |

## 22. CLI inventory (admin-relevant; full annotated table in SPIKES-findings.md Spike D)

Top-level commands (V via `hermes --help`): chat, model, moa, fallback, worktree, browser, secrets, egress, migrate, codex-runtime, gateway, proxy, lsp, setup, whatsapp, whatsapp-cloud, slack, send, logout, auth, status, pause, resume, cron, sync, webhook, peer, portal, kanban, project, hooks, doctor, verify, security, approvals, dump, debug, backup, checkpoints, import, import-agent, config, skin, console, pairing, skills, bundles, plugins, curator, pets, journey, **update**, **dashboard**, **logs** (from the footer examples; `update`/`dashboard`/`logs` V via `hermes update --help` and help footer).
