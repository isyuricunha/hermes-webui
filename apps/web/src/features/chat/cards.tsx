import { useMemo, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Info,
  Search,
  SquareTerminal,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { TranscriptReasoning, TranscriptSystem, TranscriptTool } from './transcript';
import { stagedWriteOf } from '../../lib/writeApprovals';
import { StagedWriteActions } from '../settings/PendingWrites';

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

/** Icon for a Hermes tool name (toolset families, best effort). */
function ToolGlyph({ name }: { name: string }) {
  const key = name.toLowerCase();
  const className = 'size-3.5';
  if (/terminal|shell|process|ssh|exec/.test(key)) return <SquareTerminal className={className} />;
  if (/search/.test(key)) return <Search className={className} />;
  if (/web|browser|http|fetch|url/.test(key)) return <Globe className={className} />;
  if (/file|read|write|patch|edit/.test(key)) return <FileText className={className} />;
  if (/code/.test(key)) return <Code2 className={className} />;
  if (/memory|session_search|skill/.test(key)) return <Brain className={className} />;
  if (/delegat|agent/.test(key)) return <Users className={className} />;
  return <Wrench className={className} />;
}

/** "terminal" -> "Terminal", "web_search" -> "Web search". */
function toolLabel(name: string): string {
  const spaced = name.replace(/^mcp[-_]/, '').replace(/[_-]+/g, ' ').trim();
  return spaced === '' ? 'Tool' : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  return `${Math.max(1, Math.round(durationMs))}ms`;
}

export function ToolCard({ tool }: { tool: TranscriptTool }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => actionSummary(tool.preview, ''), [tool.preview]);
  const output = useMemo(
    () => (tool.preview === undefined ? '' : formatToolPayload(tool.preview)),
    [tool.preview],
  );
  const truncated = output.length > MAX_EXPANDED_CHARS;
  const duration = formatDuration(tool.durationMs);
  const running = tool.state === 'running';
  // A memory/skill write the approval gate held back: approve it right here.
  const staged = useMemo(() => stagedWriteOf(tool.name, tool.preview), [tool.name, tool.preview]);

  return (
    <div className="yu-card my-1.5 w-full overflow-hidden rounded-xl text-[13px]" data-tool-card={tool.name}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-input"
        aria-expanded={open}
        aria-label={`${tool.name} tool call, ${tool.state}`}
      >
        <span
          aria-hidden
          className={[
            'flex size-6 shrink-0 items-center justify-center rounded-md',
            tool.state === 'failed' ? 'yu-chip-danger' : 'bg-chip text-text-secondary',
          ].join(' ')}
        >
          <ToolGlyph name={tool.name} />
        </span>
        <span className="shrink-0 font-medium text-text-primary">{toolLabel(tool.name)}</span>
        <span
          className={[
            'min-w-0 flex-1 truncate font-mono text-xs',
            running ? 'yu-shimmer' : 'text-text-tertiary',
          ].join(' ')}
        >
          {summary !== '' ? summary : running ? 'Running…' : ''}
        </span>
        {duration !== null ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">{duration}</span>
        ) : null}
        <span aria-hidden className="flex shrink-0 items-center">
          {tool.state === 'completed' ? (
            <Check className="size-3.5 text-success" />
          ) : tool.state === 'failed' ? (
            <X className="size-3.5 text-danger" />
          ) : (
            <span className="yu-pulse size-1.5 rounded-full bg-agent text-agent" />
          )}
        </span>
        <ChevronRight
          aria-hidden
          className={['size-3.5 shrink-0 text-text-tertiary transition-transform', open ? 'rotate-90' : ''].join(' ')}
        />
      </button>
      {open ? (
        <pre className="max-h-80 overflow-auto border-t border-border-subtle bg-surface-editor px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
          {output === '' ? '(no output captured)' : truncated ? `${output.slice(0, MAX_EXPANDED_CHARS)}\n… truncated` : output}
          {tool.error ? `\n[error] ${tool.error}` : ''}
        </pre>
      ) : null}
      {staged !== null ? <StagedWriteActions subsystem={staged.subsystem} id={staged.id} /> : null}
    </div>
  );
}

export function ReasoningBlock({ reasoning }: { reasoning: TranscriptReasoning }) {
  return (
    <details className="group mx-auto w-full max-w-3xl px-4 py-0.5" data-reasoning-block>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 text-xs font-medium text-agent-soft select-none hover:text-text-primary [&::-webkit-details-marker]:hidden">
        <Brain className="size-3.5" aria-hidden />
        Reasoning
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="mt-1 mb-2 border-l border-border-strong pl-3.5">
        <p className="max-h-72 overflow-y-auto py-0.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
          {reasoning.text}
        </p>
      </div>
    </details>
  );
}

const TONE: Record<TranscriptSystem['tone'], { icon: ReactNode; className: string }> = {
  info: { icon: <Info className="size-3.5" />, className: 'bg-chip text-text-secondary' },
  success: { icon: <Check className="size-3.5" />, className: 'yu-chip-success' },
  warning: { icon: <TriangleAlert className="size-3.5" />, className: 'yu-chip-warning' },
};

export function SystemCommandCard({ card }: { card: TranscriptSystem }) {
  const tone = TONE[card.tone];
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-1" data-system-card>
      <div className="yu-card flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-[13px]">
        <span aria-hidden className={['mt-px flex size-6 shrink-0 items-center justify-center rounded-md', tone.className].join(' ')}>
          {tone.icon}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-text-primary">{card.title}</p>
          {card.detail !== undefined && card.detail !== '' ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-text-secondary">{card.detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
