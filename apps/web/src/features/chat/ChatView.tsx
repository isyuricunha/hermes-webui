import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { ArrowDown, Check, Copy, ShieldAlert, X } from 'lucide-react';
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
import { useAuthState } from '../../lib/auth';

// --- Subcomponents -----------------------------------------------------------

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.innerText ?? '';
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="group/code relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="yu-btn yu-btn-tonal absolute top-2 right-2 size-7 rounded-lg opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="yu-prose min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = {
  once: 'Allow once',
  session: 'Allow for this session',
  always: 'Always allow',
  deny: 'Deny',
};

function ApprovalCard({
  approval,
  runId,
  onResolved,
}: {
  approval: TranscriptApproval;
  runId: string | null;
  onResolved: (choice: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const resolve = (choice: 'once' | 'session' | 'always' | 'deny') => {
    if (runId === null || pending !== null) return;
    setPending(choice);
    void resolveApproval(runId, {
      choice,
      ...(approval.requestId ? { request_id: approval.requestId } : {}),
    })
      .catch(() => undefined)
      .finally(() => onResolved(choice));
  };
  if (approval.resolvedChoice) {
    const denied = approval.resolvedChoice === 'deny';
    return (
      <div className="my-1.5">
        <span className={['yu-chip', denied ? 'yu-chip-danger' : 'yu-chip-success'].join(' ')}>
          {denied ? <X className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />}
          {denied ? 'Denied' : `Approved · ${APPROVAL_LABELS[approval.resolvedChoice] ?? approval.resolvedChoice}`}
        </span>
      </div>
    );
  }
  const choices = (approval.choices.length > 0 ? approval.choices : ['once', 'deny']).filter(
    (choice): choice is 'once' | 'session' | 'always' | 'deny' => choice in APPROVAL_LABELS,
  );
  const allow = choices.filter((choice) => choice !== 'deny');
  return (
    <div className="yu-sheen my-2 rounded-2xl p-4" role="group" aria-label="Approval required">
      <div className="flex items-center gap-2.5">
        <span className="yu-chip-accent flex size-7 items-center justify-center rounded-lg" aria-hidden>
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Hermes wants to run this</p>
          <p className="text-xs text-text-tertiary">
            {approval.tool !== undefined ? `${approval.tool} · ` : ''}needs your approval
          </p>
        </div>
      </div>
      {approval.command ? (
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border-subtle bg-surface-editor px-3.5 py-2.5 font-mono text-xs leading-relaxed text-text-primary">
          {approval.command}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {allow.map((choice, index) => (
          <button
            key={choice}
            type="button"
            disabled={pending !== null}
            onClick={() => resolve(choice)}
            className={['yu-btn h-9 px-3.5 text-[13px]', index === 0 ? 'yu-btn-primary' : 'yu-btn-secondary'].join(' ')}
          >
            {APPROVAL_LABELS[choice]}
          </button>
        ))}
        {choices.includes('deny') ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => resolve('deny')}
            className="yu-btn yu-btn-danger h-9 px-3.5 text-[13px]"
          >
            Deny
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ThinkingRow() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2" role="status" aria-live="polite">
      <span className="yu-shimmer-agent text-sm">Thinking…</span>
    </div>
  );
}

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function EmptyState() {
  const auth = useAuthState();
  const name = auth.data?.user?.displayName ?? auth.data?.user?.username ?? null;
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-16 text-center">
      <h1 className="yu-rise text-[34px] leading-tight font-normal tracking-[-0.03em] sm:text-[44px]">
        {greeting(new Date().getHours())}
        {name !== null ? (
          <>
            , <span className="yu-shimmer-gold pr-[0.12em] italic">{name.charAt(0).toUpperCase() + name.slice(1)}</span>
          </>
        ) : null}
      </h1>
      <p className="yu-rise mt-3 max-w-md text-sm text-text-secondary" style={{ ['--yu-delay' as string]: '100ms' }}>
        Same Hermes as on Telegram: memory, skills and tools included. Type{' '}
        <kbd className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs">/</kbd> for commands.
      </p>
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
      if (item.role === 'user') {
        return (
          <article className="mx-auto flex w-full max-w-3xl justify-end px-4 py-2">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-chip px-4 py-2.5 text-[15px] leading-relaxed text-text-primary shadow-[var(--yu-highlight)]">
              <p className="whitespace-pre-wrap break-words">{item.content}</p>
            </div>
          </article>
        );
      }
      if (item.content === '' && !item.streaming) {
        return null;
      }
      return (
        <article className="mx-auto w-full max-w-3xl px-4 py-2">
          <Markdown text={item.content} />
          {item.streaming ? (
            <span className="yu-pulse ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-agent text-agent" aria-hidden />
          ) : null}
        </article>
      );
    case 'reasoning':
      return <ReasoningBlock reasoning={item} />;
    case 'system':
      return <SystemCommandCard card={item} />;
    case 'commentary':
      return (
        <div className="mx-auto w-full max-w-3xl px-4 py-1">
          <p className="border-l border-border-strong pl-3.5 text-[13px] text-text-secondary italic">{item.text}</p>
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
          <ApprovalCard approval={item} runId={runId} onResolved={onResolved} />
        </div>
      );
    case 'error':
      return (
        <div className="mx-auto w-full max-w-3xl px-4 py-1">
          <p role="alert" className="yu-chip-danger rounded-xl px-3.5 py-2.5 text-[13px]">
            {item.message}
          </p>
        </div>
      );
  }
}

/** Tool names recorded on assistant rows, keyed by call id (OpenAI shape). */
function toolCallNames(toolCalls: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.flatMap((call: unknown) => {
    if (typeof call !== 'object' || call === null) return [];
    const record = call as { id?: unknown; name?: unknown; function?: { name?: unknown } };
    const name = record.function?.name ?? record.name;
    return typeof name === 'string' && name !== ''
      ? [{ id: typeof record.id === 'string' ? record.id : null, name }]
      : [];
  });
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
      return {
        ...emptyTranscript,
        sessionId: action.sessionId,
        items: action.items,
        // A failed run's message outlives the history reload that follows it.
        runError: state.sessionId === action.sessionId ? state.runError : undefined,
      };
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
    // Tool result rows carry no name: take it from the assistant row that
    // issued the call (by tool_call_id, else in call order).
    let pendingCalls: { id: string | null; name: string }[] = [];
    for (const row of rows) {
      if (row.role === 'assistant') {
        pendingCalls = toolCallNames(row.tool_calls);
      }
      if (row.reasoning !== null && row.reasoning !== undefined && row.reasoning !== '') {
        items.push({ kind: 'reasoning', id: `history-rsn-${row.id}`, text: row.reasoning });
      }
      if (row.role === 'user') {
        items.push({ kind: 'message', id: `history-${row.id}`, role: 'user', content: row.content });
      } else if (row.role === 'tool') {
        // Persisted tool result: compact card, never raw JSON in the chat.
        const callId = row.tool_call_id;
        const byId = pendingCalls.findIndex((call) => call.id !== null && call.id === callId);
        const [call] = pendingCalls.splice(byId === -1 ? 0 : byId, 1);
        items.push({
          kind: 'tool',
          id: `history-tool-${row.id}`,
          name: call?.name ?? 'tool',
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
        // Forget the run in state too: the history reload below resets the
        // transcript (runDone=false), and a still-set run id would make the
        // resume effect append the final output a second time.
        setActiveRunId(null);
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
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
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
  // "Thinking…" fills the gap until something visible streams in.
  const lastItem = transcript.items[transcript.items.length - 1];
  const showThinking =
    running &&
    pendingApprovals.length === 0 &&
    !transcript.items.some((item) => item.kind === 'tool' && item.state === 'running') &&
    !(lastItem?.kind === 'message' && lastItem.role === 'assistant' && lastItem.content !== '');

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRefCallback}
        onScroll={(event) => {
          const node = event.currentTarget;
          setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
        }}
        className="flex-1 overflow-y-auto pt-6 pb-4"
      >
        {transcript.items.length === 0 && !running ? (
          <EmptyState />
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
        {showThinking ? <ThinkingRow /> : null}
        {transcript.runError ? (
          <div className="mx-auto w-full max-w-3xl px-4 py-1">
            <p role="alert" className="yu-chip-danger rounded-xl px-3.5 py-2.5 text-[13px]">
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
          className="yu-pop yu-btn absolute bottom-32 left-1/2 z-10 h-8 -translate-x-1/2 rounded-full px-3 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Latest
        </button>
      ) : null}

      <div className="relative mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent"
        />
        {error !== null ? (
          <p role="alert" className="yu-chip-danger mb-2 rounded-xl px-3.5 py-2 text-xs">
            {error}
          </p>
        ) : null}
        {running && pendingApprovals.length > 0 ? (
          <p className="mb-2 px-1 text-xs text-accent">
            {pendingApprovals.length} approval{pendingApprovals.length > 1 ? 's' : ''} waiting above.
          </p>
        ) : null}
        <Composer
          key={sessionId ?? 'new'}
          running={running || sending}
          onSend={(text) => void send(text)}
          onSteer={running ? (text) => void steer(text) : undefined}
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
