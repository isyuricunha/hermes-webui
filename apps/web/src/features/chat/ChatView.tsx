import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  createRun,
  createSession,
  fetchRun,
  fetchSessionMessages,
  resolveApproval,
  stopRun,
  steerRun,
} from '../../lib/api';
import {
  applyEvent,
  emptyTranscript,
  type TranscriptApproval,
  type TranscriptItem,
  type TranscriptState,
  type TranscriptTool,
} from './transcript';
import { loadActiveRunId, saveActiveRunId } from './runRegistry';
import { useRunStream } from './useRunStream';
import { Composer } from './Composer';

// --- Subcomponents -----------------------------------------------------------

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed [&_a]:text-accent [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface [&_pre]:p-3 [&_pre]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ToolCard({ tool }: { tool: TranscriptTool }) {
  const [open, setOpen] = useState(false);
  const label =
    tool.state === 'running'
      ? `Running ${tool.name}…`
      : `${tool.name} · ${tool.state === 'failed' ? 'failed' : `${Math.round((tool.durationMs ?? 0) * 1000) / 1000 || '?'}s`}`;
  return (
    <div className="my-1 rounded-lg border border-border-subtle bg-surface-elevated text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary"
        aria-expanded={open}
      >
        <span className={tool.state === 'failed' ? 'text-danger' : ''}>{label}</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {tool.preview !== undefined && tool.preview !== '' ? (
        <p className="line-clamp-2 px-3 pb-2 font-mono text-[11px] text-text-secondary">{tool.preview}</p>
      ) : null}
      {open ? (
        <pre className="max-h-64 overflow-auto border-t border-border-subtle p-3 font-mono text-[11px] whitespace-pre-wrap">
          {tool.preview ?? '(no output captured)'}
        </pre>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  approval,
  runId,
  onResolved,
}: {
  approval: TranscriptApproval;
  runId: string | null;
  onResolved: (choice: string) => void;
}) {
  const resolve = (choice: 'once' | 'session' | 'always' | 'deny') => {
    if (runId === null) return;
    void resolveApproval(runId, {
      choice,
      ...(approval.requestId ? { request_id: approval.requestId } : {}),
    })
      .catch(() => undefined)
      .finally(() => onResolved(choice));
  };
  if (approval.resolvedChoice) {
    return (
      <div className="my-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-xs text-text-secondary">
        Approval {approval.resolvedChoice}
      </div>
    );
  }
  return (
    <div className="my-2 rounded-lg border border-warning bg-surface-elevated p-3 text-sm">
      <p className="font-medium">Hermes wants to execute:</p>
      {approval.command ? (
        <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-xs">{approval.command}</pre>
      ) : (
        <p className="mt-1 text-text-secondary">{approval.tool}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => resolve('deny')}
          className="rounded-lg border border-danger px-3 py-1 text-xs font-medium text-danger"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => resolve('once')}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => resolve('session')}
          className="rounded-lg border border-border-subtle px-3 py-1 text-xs"
        >
          Allow session
        </button>
      </div>
    </div>
  );
}

function TranscriptItemView({
  item,
  runId,
  onResolved,
}: {
  item: TranscriptItem;
  runId: string | null;
  onResolved: (choice: string) => void;
}) {
  switch (item.kind) {
    case 'message':
      return (
        <article
          className={[
            'mx-auto w-full max-w-3xl px-4 py-2',
            item.role === 'user' ? 'flex justify-end' : '',
          ].join(' ')}
        >
          <div
            className={[
              item.role === 'user'
                ? 'max-w-[85%] rounded-2xl bg-accent px-4 py-2 text-sm text-white'
                : 'w-full',
            ].join(' ')}
          >
            {item.role === 'assistant' ? (
              item.reasoning ? (
                <details className="mb-1 text-xs text-text-secondary">
                  <summary className="cursor-pointer select-none">Reasoning</summary>
                  <p className="mt-1 whitespace-pre-wrap">{item.reasoning}</p>
                </details>
              ) : null
            ) : null}
            {item.role === 'assistant' ? (
              <Markdown text={item.content} />
            ) : (
              <p className="whitespace-pre-wrap">{item.content}</p>
            )}
            {item.streaming ? <span className="animate-pulse text-text-secondary">▍</span> : null}
          </div>
        </article>
      );
    case 'commentary':
      return (
        <div className="mx-auto w-full max-w-3xl px-4">
          <blockquote className="border-l-2 border-border-subtle pl-3 text-xs text-text-secondary italic">
            {item.text}
          </blockquote>
        </div>
      );
    case 'tool':
      return (
        <div className="mx-auto w-full max-w-3xl px-4">
          <ToolCard tool={item} />
        </div>
      );
    case 'approval':
      return (
        <div className="mx-auto w-full max-w-3xl px-4">
          <ApprovalCard approval={item} runId={runId ?? ''} onResolved={onResolved} />
        </div>
      );
    case 'error':
      return (
        <div className="mx-auto w-full max-w-3xl px-4">
          <p className="rounded-lg border border-danger bg-surface-elevated px-3 py-2 text-sm text-danger">
            {item.message}
          </p>
        </div>
      );
  }
}

// --- Chat view ---------------------------------------------------------------

type ChatAction =
  | { type: 'reset'; items: TranscriptItem[] }
  | { type: 'event'; frame: Parameters<typeof applyEvent>[1] }
  | { type: 'appendUser'; text: string }
  | { type: 'approvalResolved'; approvalId: string; choice: string };

function transcriptReducer(state: TranscriptState, action: ChatAction): TranscriptState {
  switch (action.type) {
    case 'reset':
      return { ...emptyTranscript, items: action.items };
    case 'event':
      return applyEvent(state, action.frame);
    case 'appendUser':
      return {
        ...state,
        items: [
          ...state.items,
          { kind: 'message', id: `local-${Date.now()}`, role: 'user', content: action.text },
        ],
      };
    case 'approvalResolved': {
      const items = state.items.map((item) =>
        item.kind === 'approval' && item.id === action.approvalId
          ? { ...item, resolvedChoice: action.choice }
          : item,
      );
      return { ...state, items };
    }
  }
}

export function ChatView({ sessionId }: { sessionId?: string }) {
  const queryClient = useQueryClient();
  const [transcript, dispatch] = useReducer(transcriptReducer, emptyTranscript);
  const [activeRunId, setActiveRunId] = useState<string | null>(() =>
    sessionId ? loadActiveRunId(sessionId) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // History
  const messagesQuery = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => fetchSessionMessages(sessionId as string),
    enabled: sessionId !== undefined,
  });

  useEffect(() => {
    if (sessionId === undefined || !messagesQuery.data) {
      return;
    }
    const rows = [...messagesQuery.data.data].sort((a, b) => a.id - b.id);
    const items: TranscriptItem[] = rows.map((row) => ({
      kind: 'message',
      id: `history-${row.id}`,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning ?? undefined,
    }));
    dispatch({ type: 'reset', items });
  }, [sessionId, messagesQuery.data]);

  // Resume: a registry run either streams or has reached a terminal state.
  useEffect(() => {
    if (sessionId === undefined || activeRunId === null) {
      return;
    }
    let cancelled = false;
    void fetchRun(activeRunId)
      .then((status) => {
        if (cancelled) return;
        if (status.completed || ['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)) {
          if (status.output && messagesQuery.data === undefined) {
            dispatch({
              type: 'event',
              frame: { type: 'run.completed', runId: activeRunId, output: status.output },
            });
          }
          saveActiveRunId(sessionId, null);
          setActiveRunId(null);
        }
      })
      .catch(() => {
        // run id may have expired (24h retention): forget it
        if (!cancelled) {
          saveActiveRunId(sessionId, null);
          setActiveRunId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, activeRunId, messagesQuery.data]);

  const handleEvent = useCallback(
    (frame: Parameters<typeof applyEvent>[1]) => {
      dispatch({ type: 'event', frame });
      if (['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(frame.type)) {
        if (sessionId !== undefined) {
          saveActiveRunId(sessionId, null);
        }
        void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      }
    },
    [sessionId, queryClient],
  );

  useRunStream(activeRunId, handleEvent);

  const scrollRefCallback = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null && nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
  });

  const send = async (text: string) => {
    setError(null);
    try {
      let targetSession = sessionId;
      if (targetSession === undefined) {
        const created = await createSession({ title: text.slice(0, 60) });
        targetSession = created.session.id;
      }
      dispatch({ type: 'appendUser', text });
      const run = await createRun(text, targetSession);
      saveActiveRunId(targetSession, run.run_id);
      setActiveRunId(run.run_id);
      if (targetSession !== sessionId) {
        window.history.replaceState(null, '', `/chat/${encodeURIComponent(targetSession)}`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to start the run.');
    }
  };

  const stop = async () => {
    if (activeRunId === null) return;
    try {
      await stopRun(activeRunId);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Stop failed.');
    }
  };

  const steer = async (text: string) => {
    if (activeRunId === null) return;
    try {
      await steerRun(activeRunId, text);
    } catch (steerError) {
      setError(steerError instanceof Error ? steerError.message : 'Steer failed.');
    }
  };

  const running = activeRunId !== null && !transcript.runDone;
  const pendingApprovals = transcript.items.filter(
    (item): item is TranscriptApproval => item.kind === 'approval' && item.resolvedChoice === undefined,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRefCallback}
        onScroll={(event) => {
          const node = event.currentTarget;
          setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
        }}
        className="flex-1 overflow-y-auto py-4"
      >
        {sessionId === undefined && transcript.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">New chat</h1>
            <p className="max-w-md text-sm text-text-secondary">
              Talk to Hermes. Sessions, tools and settings stay one click away.
            </p>
          </div>
        ) : (
          transcript.items.map((item) => (
            <TranscriptItemView
              key={item.id}
              item={item}
              runId={activeRunId}
              onResolved={(choice) =>
                dispatch({ type: 'approvalResolved', approvalId: item.id, choice })
              }
            />
          ))
        )}
        {transcript.runError ? (
          <div className="mx-auto w-full max-w-3xl px-4">
            <p className="rounded-lg border border-danger px-3 py-2 text-sm text-danger">
              {transcript.runError}
            </p>
          </div>
        ) : null}
      </div>

      {!nearBottom ? (
        <button
          type="button"
          onClick={() => {
            const node = scrollRef.current;
            if (node !== null) {
              node.scrollTop = node.scrollHeight;
              setNearBottom(true);
            }
          }}
          className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border-subtle bg-surface-elevated px-3 py-1 text-xs shadow"
        >
          ↓ Latest
        </button>
      ) : null}

      {error !== null ? (
        <p className="border-t border-danger bg-surface px-4 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {running && pendingApprovals.length > 0 ? (
        <p className="px-4 pb-1 text-xs text-warning">
          {pendingApprovals.length} approval{pendingApprovals.length > 1 ? 's' : ''} pending in the
          transcript above.
        </p>
      ) : null}

      <div className="sticky bottom-0">
        {running ? (
          <form
            className="flex items-center gap-2 border-t border-border-subtle bg-surface px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              const input = (event.currentTarget.elements.namedItem('steer') as HTMLInputElement);
              const text = input.value.trim();
              if (text !== '') {
                void steer(text);
                input.value = '';
              }
            }}
          >
            <input
              name="steer"
              placeholder="Steer the running task… (Enter)"
              aria-label="Steer the running task"
              className="h-9 flex-1 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
            />
            <button type="submit" className="rounded-xl border border-border-subtle px-3 py-2 text-xs">
              Steer
            </button>
          </form>
        ) : null}
        <Composer
          key={sessionId ?? 'new'}
          running={running}
          onSend={(text) => void send(text)}
          onStop={() => void stop()}
          draftKey={sessionId ?? 'new'}
        />
      </div>
    </div>
  );
}
