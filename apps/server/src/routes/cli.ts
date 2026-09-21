import type { FastifyInstance } from 'fastify';
import { BRIDGE_COMMANDS, findBridgeCommand, matchesAllowlist } from '../cli/registry';
import { runHermesArgv, tokenizeCommandLine } from '../cli/runner';

/**
 * CLI bridge routes (PRD 34-36, 50). Two entry points, both locked to the
 * Hermes binary via execFile:
 *
 * 1. POST /api/cli/commands/:id/run — registry commands (declared, typed).
 * 2. POST /api/cli/run — the Advanced escape hatch: free-form text is
 *    tokenized, shell operators are rejected, and the resulting argv must
 *    match a read-only allowlist entry EXACTLY (same commands, same arity —
 *    extra flags like `--fix` are refused). `hermes update` can never pass.
 */
export async function cliRoutes(
  app: FastifyInstance,
  opts: { hermesBin: string },
): Promise<void> {
  // Free-form escape hatch gets a longer window (doctor on this host needs
  // >15s); registry commands keep their declared timeouts.
  const runnerOptions = {
    hermesBin: opts.hermesBin,
    timeoutMs: 60_000,
    maxOutputBytes: 1024 * 1024,
  };

  app.get('/api/cli/commands', async (_request, reply) => {
    return await reply.send({
      commands: BRIDGE_COMMANDS.map((command) => ({
        id: command.id,
        displayName: command.displayName,
        readOnly: command.readOnly,
        mutating: command.mutating,
        requiresConfirmation: command.requiresConfirmation,
      })),
      freeFormAllowlist: [
        'hermes lsp status',
        'hermes lsp list',
        'hermes gateway status',
        'hermes status',
        'hermes cron list',
        'hermes cron status',
        'hermes doctor',
        'hermes config show',
        'hermes skills list',
        'hermes mcp list',
      ],
    });
  });

  app.post(
    '/api/cli/commands/:id/run',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          properties: { confirm: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const command = findBridgeCommand(id);
      if (command === undefined) {
        return await reply.status(404).send({
          error: { code: 'COMMAND_NOT_FOUND', message: `No bridge command "${id}".` },
          requestId: request.id,
        });
      }
      const { confirm } = (request.body ?? {}) as { confirm?: boolean };
      if (command.requiresConfirmation && confirm !== true) {
        return await reply.status(400).send({
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: `"${command.displayName}" is mutating and requires { confirm: true }.`,
          },
          requestId: request.id,
        });
      }
      const result = await runHermesArgv(runnerOptions, command.argv);
      request.log[command.mutating ? 'warn' : 'info'](
        { action: 'cli.run', commandId: command.id, exitCode: result.exitCode, durationMs: result.durationMs },
        'cli bridge execution',
      );
      return await reply.send(result);
    },
  );

  app.post(
    '/api/cli/run',
    {
      schema: {
        body: {
          type: 'object',
          required: ['command'],
          properties: { command: { type: 'string', maxLength: 500 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { command } = request.body as { command: string };
      const { tokens, error } = tokenizeCommandLine(command);
      if (error !== undefined) {
        return await reply.status(400).send({
          error: { code: 'SHELL_OPERATOR_FORBIDDEN', message: error },
          requestId: request.id,
        });
      }
      if (tokens[0] !== 'hermes') {
        return await reply.status(400).send({
          error: {
            code: 'HERMES_BINARY_ONLY',
            message: 'Only commands starting with `hermes` can run here.',
          },
          requestId: request.id,
        });
      }
      const argv = tokens.slice(1);
      if (!matchesAllowlist(argv)) {
        return await reply.status(403).send({
          error: {
            code: 'NOT_ALLOWLISTED',
            message:
              'This command is not on the read-only allowlist. Mutating flows have dedicated UIs.',
          },
          requestId: request.id,
        });
      }
      const result = await runHermesArgv({ ...runnerOptions, timeoutMs: 15_000 }, argv);
      request.log.info(
        { action: 'cli.freeform', argv, exitCode: result.exitCode, durationMs: result.durationMs },
        'cli bridge execution',
      );
      return await reply.send(result);
    },
  );
}
