import { useMemo, useState } from 'react';
import type { TranscriptReasoning, TranscriptSystem, TranscriptTool } from './transcript';

/**
 * Native transcript cards (Chat UX goal): compact by default, inspectable on
 * demand. Reasoning, tool calls and native command results are distinct
 * components — none of them render as LLM chat text.
 */

const MAX_EXPANDED_CHARS = 20_000;

/**
 * Normalizes a tool payload for display:
 * - JSON objects/arrays become pretty-printed JSON
 * - literal "\n" escapes become real line breaks (single-line payloads only,
 *   so legitimate `\n` inside already-multiline text is never corrupted)
 * - anything else passes through untouched
 */
export function formatToolPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // fall through to newline normalization
    }
  }
  const literalBreaks = raw.match(/\\n/g)?.length ?? 0;
  if (literalBreaks > 0 && !raw.includes('\n')) {
    return raw.replace(/\\n/g, '\n');
  }
  return raw;
}

/** First meaningful line of a payload, for the collapsed card header. */
export function actionSummary(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw.trim() === '') return fallback;
  const formatted = formatToolPayload(raw);
  const firstLine = formatted
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && line !== '{' && line !== '[' && line !== '}' && line !== ']');
  const line = firstLine ?? '';
  if (line === '') return fallback;
  return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}

const STATE_ICON: Record<TranscriptTool['state'], string> = {
  running: '…',
  completed: '✓',
  failed: '✗',
};

export function ToolCard({ tool }: { tool: TranscriptTool }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(
    () => actionSummary(tool.preview, `${tool.name} call`),
    [tool.preview, tool.name],
  );
  const output = useMemo(
    () => (tool.preview === undefined ? '' : formatToolPayload(tool.preview)),
    [tool.preview],
  );
  const truncated = output.length > MAX_EXPANDED_CHARS;
  const duration =
    tool.durationMs === undefined
      ? null
      : tool.durationMs >= 1000
        ? `${Math.round((tool.durationMs / 1000) * 100) / 100}s`
        : `${Math.round(tool.durationMs)}ms`;

  return (
    <div
      className="my-1 w-full rounded-lg border border-border-subtle bg-surface-elevated text-xs"
      data-tool-card={tool.name}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        aria-label={`${tool.name} tool call, ${tool.state}`}
      >
        <span
          aria-hidden
          className={[
            'shrink-0 font-mono',
            tool.state === 'failed'
              ? 'text-danger'
              : tool.state === 'completed'
                ? 'text-success'
                : 'text-text-secondary',
          ].join(' ')}
        >
          {STATE_ICON[tool.state]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{tool.name}</span>
        <span className="hidden shrink-0 truncate text-text-secondary sm:block">{summary}</span>
        {duration !== null ? (
          <span className="shrink-0 tabular-nums text-text-secondary">{duration}</span>
        ) : null}
        <span aria-hidden className="shrink-0 text-text-secondary">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto border-t border-border-subtle p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
          {output === '' ? '(no output captured)' : truncated ? `${output.slice(0, MAX_EXPANDED_CHARS)}\n… truncated` : output}
          {tool.error ? `\n[error] ${tool.error}` : ''}
        </pre>
      ) : null}
    </div>
  );
}

export function ReasoningBlock({ reasoning }: { reasoning: TranscriptReasoning }) {
  return (
    <details className="mx-auto w-full max-w-3xl px-4" data-reasoning-block>
      <summary className="cursor-pointer select-none py-1 text-xs font-medium text-text-secondary hover:text-text-primary">
        Reasoning
      </summary>
      <div className="mb-1 border-l-2 border-border-subtle pl-3">
        <p className="max-h-64 overflow-y-auto py-1 text-xs whitespace-pre-wrap break-words text-text-secondary">
          {reasoning.text}
        </p>
      </div>
    </details>
  );
}

const TONE_CLASS: Record<TranscriptSystem['tone'], string> = {
  info: 'border-border-subtle',
  success: 'border-success',
  warning: 'border-warning',
};

export function SystemCommandCard({ card }: { card: TranscriptSystem }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4" data-system-card>
      <div
        className={[
          'w-full rounded-lg border bg-surface-elevated px-3 py-2 text-xs',
          TONE_CLASS[card.tone],
        ].join(' ')}
      >
        <p className="font-medium text-text-primary">
          <span aria-hidden className="mr-1.5 text-text-secondary">
            ⌘
          </span>
          {card.title}
        </p>
        {card.detail !== undefined && card.detail !== '' ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-text-secondary">{card.detail}</p>
        ) : null}
      </div>
    </div>
  );
}
