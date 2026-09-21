import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { commandArgs, findCommandIn } from '@hermes-webui/shared';
import {
  createRun,
  createSession,
  fetchAppStatus,
  fetchCommands,
  fetchRun,
  fetchSessionMessages,
  fetchSessionModel,
  resolveApproval,
  stopRun,
  steerRun,
} from '../../lib/api';
import { rememberDerivedTitle } from '../../lib/sessionTitles';
import {
  applyEvent,
  emptyTranscript,
  type TranscriptApproval,
  type TranscriptItem,
  type TranscriptState,
} from './transcript';
import { loadActiveRunId, saveActiveRunId } from './runRegistry';
import { useRunStream } from './useRunStream';
import { Composer } from './Composer';
import { ReasoningBlock, SystemCommandCard, ToolCard } from './cards';
import { ModelPicker } from './ModelPicker';
import { rememberChatSession } from '../../lib/navigation';

// --- Subcomponents -----------------------------------------------------------

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed [&_a]:text-accent [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface [&_pre]:p-3 [&_pre]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
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
              <Markdown text={item.content} />
            ) : (
              <p className="whitespace-pre-wrap">{item.content}</p>
            )}
            {item.streaming ? <span className="animate-pulse text-text-secondary">▍</span> : null}
          </div>
        </article>
      );
    case 'reasoning':
      return <ReasoningBlock reasoning={item} />;
    case 'system':
      return <SystemCommandCard card={item} />;
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
  | { type: 'reset'; items: TranscriptItem[]; sessionId: string; force?: boolean }
  | { type: 'event'; frame: Parameters<typeof applyEvent>[1]; sessionId: string }
  | { type: 'appendUser'; text: string; sessionId: string }
  | {
      type: 'systemCard';
      title: string;
      detail?: string;
      tone: 'info' | 'success' | 'warning';
    }
  | { type: 'approvalResolved'; approvalId: string; choice: string };

function transcriptReducer(state: TranscriptState, action: ChatAction): TranscriptState {
  switch (action.type) {
    case 'reset':
      // A different session always resets. The same session only resets when
      // idle: history arriving mid-stream must not discard live deltas
      // (review F9a).
      if (!action.force && state.sessionId === action.sessionId) {
        if (state.items.some((item) => item.kind === 'message' && item.streaming)) {
          return state;
        }
      }
      return { ...emptyTranscript, sessionId: action.sessionId, items: action.items };
    case 'event':
      // Drop events from a previous session after a switch.
      if (state.sessionId !== action.sessionId) return state;
      return applyEvent(state, action.frame);
    case 'appendUser':
      return {
        ...state,
        sessionId: action.sessionId,
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
    case 'systemCard': {
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: 'system' as const,
            id: `sys-${Date.now()}-${state.items.length}`,
            title: action.title,
            detail: action.detail,
            tone: action.tone,
          },
        ],
      };
    }
  }
}

export function ChatView({ sessionId }: { sessionId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [transcript, dispatch] = useReducer(transcriptReducer, emptyTranscript);
  const [activeRunId, setActiveRunId] = useState<string | null>(() =>
    sessionId ? loadActiveRunId(sessionId) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Remember the last visited session so "Back to Chat" from Settings
  // restores this conversation (navigation.ts).
  useEffect(() => {
    rememberChatSession(sessionId);
  }, [sessionId]);

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
    const items: TranscriptItem[] = [];
    for (const row of rows) {
      if (row.reasoning !== null && row.reasoning !== undefined && row.reasoning !== '') {
        items.push({ kind: 'reasoning', id: `history-rsn-${row.id}`, text: row.reasoning });
      }
      if (row.role === 'user') {
        items.push({ kind: 'message', id: `history-${row.id}`, role: 'user', content: row.content });
      } else if (row.role === 'tool') {
        // Persisted tool result: compact card, never raw JSON in the chat.
        items.push({
          kind: 'tool',
          id: `history-tool-${row.id}`,
          name: 'Tool result',
          state: 'completed',
          preview: row.content,
        });
      } else if (row.role === 'system') {
        items.push({
          kind: 'system',
          id: `history-sys-${row.id}`,
          title: 'System notice',
          detail: row.content,
          tone: 'info',
        });
      } else {
        items.push({
          kind: 'message',
          id: `history-${row.id}`,
          role: 'assistant',
          content: row.content,
        });
      }
    }
    dispatch({ type: 'reset', items, sessionId, force: true });
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
          if (status.output !== undefined) {
            dispatch({
              type: 'event',
              frame: { type: 'run.completed', runId: activeRunId, output: status.output },
              sessionId,
            });
          }
          saveActiveRunId(sessionId, null);
          setActiveRunId(null);
          // History holds the persisted messages; render them.
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
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
  }, [sessionId, activeRunId, messagesQuery.data, queryClient]);

  // Status-polling fallback while a run is active: the gateway SSE stream has
  // no late-subscribe replay (capability matrix section 8), so if events were
  // missed the run status is the only source of truth.
  useEffect(() => {
    if (sessionId === undefined || activeRunId === null || transcript.runDone) {
      return;
    }
    const interval = setInterval(() => {
      void fetchRun(activeRunId)
        .then((status) => {
          if (
            ['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)
          ) {
            dispatch({
              type: 'event',
              frame:
                status.status === 'failed'
                  ? {
                      type: 'run.failed',
                      runId: activeRunId,
                      error: status.error ?? 'The run failed.',
                    }
                  : { type: 'run.completed', runId: activeRunId, output: status.output ?? '' },
              sessionId,
            });
            saveActiveRunId(sessionId, null);
            setActiveRunId(null);
            void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          }
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(interval);
  }, [sessionId, activeRunId, transcript.runDone, queryClient]);

  const handleEvent = useCallback(
    (frame: Parameters<typeof applyEvent>[1]) => {
      dispatch({ type: 'event', frame, sessionId: sessionId ?? '' });
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

  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Recognized Hermes commands never reach the LLM as user text (Chat UX
  // goal): they execute natively here or surface an explanatory card.
  const commandsQuery = useQuery({
    queryKey: ['commands'],
    queryFn: fetchCommands,
    staleTime: 10 * 60_000,
  });
  const sessionModelQuery = useQuery({
    queryKey: ['session-model', sessionId],
    queryFn: () => fetchSessionModel(sessionId as string),
    enabled: sessionId !== undefined,
    staleTime: 30_000,
  });
  const currentModel = sessionModelQuery.data?.model ?? null;
  const currentProvider = sessionModelQuery.data?.provider ?? '';
  const modelLabel = currentModel ?? 'global default';
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

  const runCommand = useCallback(
    (cmd: NormalizedCommand, argsText: string) => {
      const notice = (title: string, detail: string, tone: 'info' | 'success' | 'warning' = 'info') =>
        dispatch({ type: 'systemCard', title, detail, tone });
      switch (cmd.handler) {
        case 'new-chat': {
          const created = createSession(argsText.trim() === '' ? {} : { title: argsText.trim().slice(0, 60) });
          void created
            .then((result) => {
              void navigate({ to: '/chat/$sessionId', params: { sessionId: result.session.id } });
              notice('New chat started', `Session ${result.session.id}`, 'success');
            })
            .catch((error: unknown) =>
              notice('Could not start a new chat', error instanceof Error ? error.message : 'Unknown error.', 'warning'),
            );
          return;
        }
        case 'model-picker':
          setPickerOpen(true);
          return;
        case 'status-card': {
          void fetchAppStatus()
            .then((status) => {
              const version = 'version' in status.hermes ? ` (v${status.hermes.version})` : '';
              notice(
                'Hermes status',
                [
                  `Gateway: ${status.hermes.state}${version}`,
                  currentModel !== null
                    ? `Session model: ${currentProvider !== '' ? `${currentProvider}/` : ''}${currentModel}`
                    : 'Model: global default (Settings > Models)',
                ].join('\n'),
              );
            })
            .catch(() => notice('Hermes status', 'Status unavailable.', 'warning'));
          return;
        }
        case 'open-sessions':
          window.dispatchEvent(new CustomEvent('hermes-webui:open-sessions'));
          return;
        case 'navigate-settings':
          void navigate({ to: '/settings' });
          return;
        case 'navigate-skills':
          void navigate({ to: '/settings/skills' });
          return;
        case 'stop-run':
          if (activeRunId !== null && !transcript.runDone) {
            void stop();
            notice('Stop requested', 'The active run is being stopped.');
          } else {
            notice('No active run', 'There is no run to stop in this session.', 'warning');
          }
          return;
        case 'help-card': {
          const total = commandsQuery.data?.commands.length ?? 0;
          notice(
            'Hermes commands',
            `Native here: /new /model /status /sessions /settings /skills /stop /help.\nType "/" to browse all ${total} registry commands (CLI/TUI-only ones are labeled).`,
          );
          return;
        }
        default:
          notice(
            `${cmd.name} is unavailable in the WebUI`,
            cmd.disabledReason ?? 'This Hermes command runs in the terminal only.',
            'warning',
          );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRunId, transcript.runDone, commandsQuery.data, currentModel, currentProvider],
  );

  const send = async (text: string) => {
    if (sending) return;
    // Command interception: recognized -> native execution; unrecognized
    // slash input -> explanatory card. Neither becomes a user message.
    const command = findCommandIn(commandsQuery.data?.commands ?? [], text);
    if (command !== undefined) {
      runCommand(command, commandArgs(text));
      return;
    }
    if (text.startsWith('/')) {
      dispatch({
        type: 'systemCard',
        title: `Unknown command ${text.split(/\s+/)[0]}`,
        detail: 'Type "/" to browse the Hermes command catalog.',
        tone: 'warning',
      });
      return;
    }
    setError(null);
    setSending(true);
    try {
      let targetSession = sessionId;
      if (targetSession === undefined) {
        const created = await createSession({ title: text.slice(0, 60) });
        targetSession = created.session.id;
      }
      rememberDerivedTitle(targetSession, text);
      dispatch({ type: 'appendUser', text, sessionId: targetSession });
      const run = await createRun(text, targetSession);
      saveActiveRunId(targetSession, run.run_id);
      setActiveRunId(run.run_id);
      if (targetSession !== sessionId) {
        window.history.replaceState(null, '', `/chat/${encodeURIComponent(targetSession)}`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to start the run.');
    } finally {
      setSending(false);
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
        {transcript.items.length === 0 ? (
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
              className="h-9 min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm outline-none focus:border-accent"
            />
            <button type="submit" className="rounded-xl border border-border-subtle px-3 py-2 text-xs">
              Steer
            </button>
          </form>
        ) : null}
        <Composer
          key={sessionId ?? 'new'}
          running={running || sending}
          onSend={(text) => void send(text)}
          onCommand={(cmd, args) => runCommand(cmd, args)}
          onOpenModelPicker={() => setPickerOpen(true)}
          modelLabel={modelLabel}
          onStop={() => void stop()}
          draftKey={sessionId ?? 'new'}
        />
        {pickerOpen ? (
          <ModelPicker sessionId={sessionId} onClose={() => setPickerOpen(false)} />
        ) : null}
      </div>
    </div>
  );
}
