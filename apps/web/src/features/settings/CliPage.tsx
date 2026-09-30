import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  fetchCliCatalog,
  runCliCommand,
  runCliFreeForm,
  type BridgeResult,
} from '../../lib/api';
import { confirmDialog } from '../../lib/dialog';
import { SettingsError, SettingsPage } from './SettingsLayout';

function ResultView({ result }: { result: BridgeResult }) {
  return (
    <div className="mt-3 yu-card rounded-2xl p-3 text-xs">
      <p className="mb-1 text-text-secondary">
        exit {result.exitCode ?? '?'} · {result.durationMs} ms
        {result.truncated ? ' · output truncated' : ''}
        {result.redacted ? ' · credentials redacted' : ''}
      </p>
      {result.stdout !== '' ? (
        <pre className="max-h-72 overflow-auto rounded-xl bg-surface-editor p-3 font-mono text-text-secondary whitespace-pre-wrap">
          {result.stdout}
        </pre>
      ) : null}
      {result.stderr !== '' ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-surface-editor p-3 font-mono text-text-secondary whitespace-pre-wrap text-danger">
          {result.stderr}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Advanced > Hermes CLI (PRD 36): a restricted escape hatch for the Hermes
 * binary only. Shell operators are rejected, argv must match a read-only
 * allowlist, output is capped and credential-redacted server-side. This is
 * never a general terminal.
 */
export function CliPage() {
  const catalogQuery = useQuery({ queryKey: ['cli-catalog'], queryFn: fetchCliCatalog });
  const [commandLine, setCommandLine] = useState('hermes lsp status');
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runRegistry = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) => runCliCommand(id, confirm),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (runError) => {
      setResult(null);
      setError(runError.message);
    },
  });

  const runFreeForm = useMutation({
    mutationFn: (command: string) => runCliFreeForm(command),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (runError) => {
      setResult(null);
      setError(runError.message);
    },
  });

  return (
    <SettingsPage title="Hermes CLI">
      <p className="mb-4 text-xs text-text-secondary">
        Restricted bridge to the Hermes binary. No shell, no arbitrary commands: argv is executed
        directly, output is capped and secrets are redacted before they reach the browser.
      </p>

      {catalogQuery.isPending ? (
        <p className="text-sm text-text-secondary">Loading commands…</p>
      ) : catalogQuery.isError ? (
        <SettingsError message={catalogQuery.error.message} />
      ) : (
        <>
          <p className="mb-2 text-[13px] font-medium text-text-secondary">
            Commands
          </p>
          <ul className="mb-6 space-y-1.5">
            {catalogQuery.data.commands.map((command) => (
              <li
                key={command.id}
                className="flex items-center justify-between yu-card rounded-2xl px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{command.displayName}</p>
                  <p className="font-mono text-[11px] text-text-secondary">{command.id}</p>
                </div>
                <button
                  type="button"
                  disabled={runRegistry.isPending}
                  onClick={async () => {
                    if (
                      command.requiresConfirmation &&
                      !(await confirmDialog({
                        title: `Run “${command.displayName}”?`,
                        description: 'This command changes Hermes state.',
                        confirmLabel: 'Run',
                      }))
                    ) {
                      return;
                    }
                    runRegistry.mutate({ id: command.id, confirm: command.requiresConfirmation });
                  }}
                  className="yu-btn yu-btn-secondary h-8 rounded-lg px-2.5 text-xs"
                >
                  Run
                </button>
              </li>
            ))}
          </ul>

          <p className="mb-2 text-[13px] font-medium text-text-secondary">
            Advanced
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              runFreeForm.mutate(commandLine);
            }}
          >
            <input
              value={commandLine}
              onChange={(event) => setCommandLine(event.target.value)}
              aria-label="Hermes command"
              spellCheck={false}
              className="h-9 flex-1 yu-card rounded-2xl px-3 font-mono text-xs outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={runFreeForm.isPending}
              className="yu-btn yu-btn-primary h-9 px-3 text-sm"
            >
              Run
            </button>
          </form>
          <details className="mt-2 text-xs text-text-secondary">
            <summary className="cursor-pointer select-none">Allowed commands</summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {catalogQuery.data.freeFormAllowlist.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </details>
        </>
      )}

      {error !== null ? (
        <div className="mt-3">
          <SettingsError message={error} />
        </div>
      ) : null}
      {result !== null ? <ResultView result={result} /> : null}
    </SettingsPage>
  );
}
