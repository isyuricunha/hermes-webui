# Hermes Command Matrix (WebUI slash commands)

Source of truth: the installed Hermes registry — `hermes_cli/commands.py`
(`COMMANDS_BY_CATEGORY`, `GATEWAY_KNOWN_COMMANDS`), verified against the live
gateway (Hermes v0.21.3, upstream 30de041b). The normalized catalog is
generated into `apps/server/src/hermes/hermes-commands.json` (provenance
header included) and served via `GET /api/commands`.

Regenerate after Hermes updates:

```bash
~/.hermes/hermes-agent/venv/bin/python - <<'PY'
from hermes_cli.commands import COMMANDS_BY_CATEGORY
import json
out = [{"name": n, "description": d, "category": c}
       for c, entries in COMMANDS_BY_CATEGORY.items() for n, d in entries.items()]
print(json.dumps(out, indent=1))
PY
```

Then merge the result into `hermes-commands.json`, keeping the WebUI
`availability`/`executionMode`/`handler` fields (native entries below).

## Execution model

The API-server run path (`agent.run_conversation`) does NOT dispatch slash
commands: recognized Hermes commands submitted through `POST /v1/runs` would
reach the LLM as ordinary user text. The WebUI therefore intercepts every
recognized command **in the composer, before send**:

- native commands execute in the browser (no network call to the LLM);
- recognized-but-unsupported commands render a compact system card with the
  reason and are never sent;
- unrecognized `/…` input renders an "unknown command" card and is never sent.

## Native WebUI commands

| Command | Handler | Behavior |
|---|---|---|
| `/new [name]` | `new-chat` | Creates a session (existing semantics) and navigates to it. |
| `/model` | `model-picker` | Opens the native model picker (session-scoped lock). |
| `/status` | `status-card` | Compact status card: gateway state/version + session model. |
| `/sessions` | `open-sessions` | Opens/focuses the conversations sidebar/drawer. |
| `/settings` | `navigate-settings` | Navigates to the Settings workspace. |
| `/skills` | `navigate-skills` | Navigates to Settings > Skills. |
| `/stop` | `stop-run` | Stops the active run, or explains there is none. |
| `/help` | `help-card` | Lists native commands and the catalog size. |

## Session-scoped vs global model changes

- `/model` and the composer chip change the **session model lock** only
  (gateway `POST /api/sessions/{id}/model`). The dialog states this scope
  explicitly.
- Global defaults are changed exclusively in Settings > Models, never from a
  chat session action.

## Unsupported commands

All remaining registry commands (~110, e.g. `/compact`, `/context`, `/tools`,
`/memory`, `/undo`) are CLI/TUI-only: they execute in the Hermes terminal and
have no WebUI mapping yet. They remain visible in the palette (labeled with
their Hermes category) but selecting one renders an explanatory card instead
of silently forwarding text to the LLM.

Skills-as-slash-commands (`/<skill-name>`) rely on the gateway turn pipeline
(`agent/skill_commands.py` scaffolding), which the API-server run path does
not execute; skill bodies therefore cannot be loaded through a WebUI slash
command. Skills remain browsable in Settings > Skills.

## Security notes

- No slash command becomes shell execution; the restricted CLI bridge
  (exact-argv allowlist) is untouched.
- Tool result previews on the wire are secret-redacted and bounded (500
  chars) by the gateway; the WebUI only formats what it receives.
- The composer/model picker never injects model/provider metadata into
  prompt-visible text; `ella/ella-large-5-2` remains the prompt-identity
  label, while the operator UI shows real provider/model ids.
