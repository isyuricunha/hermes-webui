import commandsDoc from './hermes-commands.json';
import type { NormalizedCommand } from '@hermes-webui/shared';

/**
 * Normalized Hermes command catalog for the WebUI (PRD 20: Hermes is the
 * source of truth). Derived from the installed Hermes registry
 * (`hermes_cli/commands.py COMMANDS_BY_CATEGORY`); see
 * docs/HERMES-COMMAND-MATRIX.md for the surface mapping and regeneration.
 *
 * Commands recognized by this catalog NEVER fall through to the LLM as user
 * text: native ones execute in the WebUI, unsupported ones surface a compact
 * explanatory notice (ChatView intercepts before send).
 */

export type CommandCatalog = NormalizedCommand[];

let cached: CommandCatalog | null = null;

export function commandCatalog(): CommandCatalog {
  if (cached === null) {
    cached = (commandsDoc.commands as NormalizedCommand[]).slice();
  }
  return cached;
}
