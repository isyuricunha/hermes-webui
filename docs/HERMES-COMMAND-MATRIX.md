# Hermes Command Matrix (WebUI slash commands)

Source of truth: the installed Hermes registry — `hermes_cli/commands.py`
(`COMMANDS_BY_CATEGORY`, `GATEWAY_KNOWN_COMMANDS`), verified against the live
gateway (Hermes v0.21.5). The normalized catalog is
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
commands: text sent through `POST /v1/runs` reaches the LLM as-is. The WebUI
therefore intercepts every `/word` **in the composer, before send**, and each
catalog entry has an `availability`:

- **`native`** (30): runs in the WebUI (below).
- **`hermes`** (76): runs inside Hermes through the dashboard's JSON-RPC
  websocket, like Hermes' desktop app: `POST /api/auth/ws-ticket` gives a
  single-use ticket, the WebUI server opens `/api/ws` with it, resumes the
  conversation lazily (`session.resume`) and calls `slash.exec` (skill and
  bundle commands go through `command.dispatch`). Results:
  `output` renders as a terminal-style card, `send` (skills, `/plan`,
  `/queue`...) is submitted as a normal turn, `prefill` goes to the composer.
  See `apps/server/src/hermes/slashBridge.ts` and `POST /api/commands/exec`.
- **`unsupported`** (12): about the terminal screen itself (`/redraw`,
  `/statusbar`, `/footer`, `/timestamps`, `/compose`, `/quit`...); a card says
  so and what to use instead.

Any `/word` that is not in the catalog also goes to Hermes, so skill commands
(`/<skill-name>`) and plugin commands work.

Hermes' slash worker has no live agent for a resumed conversation, so the
commands that read the live agent (`/context`, `/usage`, `/status`) are native
and use the conversation's numbers from the dashboard session row (last prompt
tokens in `model_config._usage_anchor`, token totals) and `/api/model/info`
for the window size.

## Native WebUI commands

| Command | Handler | Behavior |
|---|---|---|
| `/new [name]`, `/reset`, `/clear` | `new-chat` | Creates a session and opens it. |
| `/model` | `model-picker` | Model picker (session-scoped lock). |
| `/status` | `status-card` | Gateway, WebUI version, real model, reasoning effort, context, tokens, run state. |
| `/context`, `/ctx` | `context-card` | Messages, model, context used / window (%). |
| `/usage` | `usage-card` | Session tokens (in, out, cache, reasoning), API calls, approx. cost. |
| `/reasoning [level]` | `reasoning` | Shows or sets `agent.reasoning_effort` (applies from the next message); display options go to Hermes. |
| `/title [name]` | `rename-session` | Renames the conversation. |
| `/fork`, `/branch` | `fork-session` | Forks the conversation. |
| `/export [json]` | `export-session` | Downloads Markdown (or JSON). |
| `/copy` | `copy-last` | Copies the last reply. |
| `/retry` | `retry-last` | Re-sends the last message. |
| `/steer <msg>` | `steer` | Steers the running reply (or sends when idle). |
| `/queue`, `/q <msg>` | `queue` | Sends when the current reply finishes. |
| `/image`, `/paste` | `attach` | Opens the file picker. |
| `/sessions`, `/resume` | `open-sessions` | Opens the conversations sidebar. |
| `/settings` | `navigate-settings` | Opens Settings. |
| `/skills [hub args]` | `navigate-skills` | Settings > Skills; with arguments, Hermes' skills hub. |
| `/skin` | `navigate-appearance` | Settings > Appearance (themes, YuCode). |
| `/palette` | `open-palette` | Command palette. |
| `/voice` | `voice` | Points to the mic button and read aloud. |
| `/memory [pending\|approve\|reject\|approval] [id\|all\|on\|off]` | `memory-approvals` | Pending memory writes, through Hermes' own `/memory` handler. |
| `/stop` | `stop-run` | Stops the active run. |
| `/help` | `help-card` | How commands work here. |

## Session-scoped vs global changes

- `/model` and the model chip change the **session model lock** only.
- Commands that Hermes runs may change Hermes' config (e.g. `/personality`,
  `/reasoning --global`); new runs pick it up, as in the terminal.

## Security notes

- No slash command becomes shell execution in the WebUI; commands run in
  Hermes' own slash worker with the signed-in dashboard session. The request
  body is validated (one line, bounded, `/name` shape).
- Tool result previews on the wire are secret-redacted and bounded (500
  chars) by the gateway; the WebUI only formats what it receives.
- The composer/model picker never injects model/provider metadata into
  prompt-visible text; `ella/ella-large-5-2` remains the prompt-identity
  label, while the operator UI shows real provider/model ids.
