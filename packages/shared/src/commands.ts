/**
 * Normalized Hermes command catalog types (Chat UX goal). The catalog is
 * derived server-side from the installed Hermes registry
 * (hermes_cli/commands.py) and served via GET /api/commands; see
 * docs/HERMES-COMMAND-MATRIX.md. Recognized commands NEVER fall through to
 * the LLM as user text.
 */

export type CommandAvailability = 'native' | 'unsupported';

export interface NormalizedCommand {
  name: string;
  description: string;
  category: string;
  aliases: string[];
  argsHint: string | null;
  availability: CommandAvailability;
  executionMode: 'webui-native' | 'disabled';
  handler?: string;
  disabledReason?: string;
  webuiOnly?: boolean;
}

/**
 * Resolves the command invoked by a composer input, if any. Matches the
 * leading word against primary names and aliases, slash optional,
 * case-insensitive. Returns undefined for non-command input.
 */
export function findCommandIn(
  commands: NormalizedCommand[],
  input: string,
): NormalizedCommand | undefined {
  const token = input.trim().toLowerCase();
  if (!token.startsWith('/')) return undefined;
  const firstWord = token.slice(1).split(/\s+/)[0] ?? '';
  if (firstWord === '') return undefined;
  return commands.find(
    (cmd) =>
      cmd.name.slice(1).toLowerCase() === firstWord ||
      cmd.aliases.some((alias) => alias.toLowerCase() === firstWord),
  );
}

/** Everything after the command word (the argument text), '' when absent. */
export function commandArgs(input: string): string {
  const parts = input.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}
