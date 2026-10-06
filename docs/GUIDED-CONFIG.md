# Guided Config & Raw Config

Hermes WebUI settings under **Advanced** expose two ways to edit `~/.hermes/config.yaml` without opening a terminal.

## Raw Config (`/settings/advanced/config`)

- Full YAML editor with line numbers, live validation, and a review diff before save.
- **Blocking errors:** YAML syntax failures, duplicate keys, non-mapping top level.
- **Warnings only:** schema type/option mismatches (custom skins, models, unquoted numbers that Hermes still accepts). These do **not** block save — Hermes is the source of truth and often runs values the dashboard schema does not list.
- Writes go through the dashboard raw-config endpoint after a local backup under the WebUI data directory (`config-backups/`, newest 40 kept).
- Concurrent edits are detected with a short content revision hash (`rev`).

## Guided Config (`/settings/advanced/guided-config`)

Schema-driven form for **scalar** settings only (`string`, `number`, `boolean`, `select`). Lists, maps, credentials, providers, and MCP stay in Raw Config or their dedicated Settings pages.

### Safety tiers

Defined in `packages/shared/src/configSafety.ts`:

| Tier | Behaviour |
|------|-----------|
| **free** | Edit directly |
| **confirm** | Requires explicit confirmation in the review step |
| **locked** | Hidden from guided UI; Raw Config only |

### Numeric min / max

The Hermes dashboard schema does **not** publish min/max. Bounds are curated in `packages/shared/src/configBounds.ts` from Hermes documentation and upstream clamps (for example `delegation.max_spawn_depth` 1–3, `vision.embed_target_bytes` 64 KiB–4 MiB).

- The guided UI shows the range under number controls and sets `min` / `max` on the input.
- The server re-checks bounds on every guided write (`checkConfigBound`).
- Paths without an entry stay unbounded aside from “must be a finite number”.

When Hermes documents a new clamp, add it to `CONFIG_BOUNDS` and mention the source in the file header comment.

### Restore default

Setting a value back to the schema default issues an **unset** (key removed from `config.yaml`) so Hermes falls through to its built-in default — not `null` or `0`.

## Shared write path

Both UIs share the same mutation pipeline conceptually:

1. Validate (syntax and/or ops)
2. Backup current YAML
3. Write via dashboard
4. Re-read and verify

Hermes itself is never restarted by these routes; only the WebUI process is redeployed when shipping UI changes.
