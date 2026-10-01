import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { commandArgs, findCommandIn } from '@hermes-webui/shared';
import {
  createRun,
  createSession,
  execHermesCommand,
  fetchAppStatus,
  fetchCommands,
  fetchModelInfo,
  fetchRun,
  fetchSessionContext,
  fetchSessionImages,
  fetchSessionMessages,
  fetchSessionModel,
  stopRun,
  steerRun,
} from '../../lib/api';
import { rememberDerivedTitle } from '../../lib/sessionTitles';
import {
  appendSteer,
  applyEvent,
  emptyTranscript,
  type ReplyStats,
  type MessageAttachment,
  type TranscriptApproval,
  type TranscriptItem,
  type TranscriptState,
} from './transcript';
import { loadActiveRunId, saveActiveRunId } from './runRegistry';
import { useRunStream } from './useRunStream';
import { Composer } from './Composer';
import { insertIntoComposer } from './composerBus';
import { ReasoningBlock, SystemCommandCard, ToolCard } from './cards';
import { ModelPicker } from './ModelPicker';
import { rememberChatSession } from '../../lib/navigation';
import { ApprovalCard } from './ApprovalCard';
import { AssistantMessage, UserMessage } from './MessageView';
import { EmptyState } from './EmptyState';
import { ChatHeader } from './ChatHeader';
import { historyToItems } from './history';
import { buildRunInput, type PendingAttachment } from './attachments';
import { notifyRunFinished } from '../../lib/notify';
import { pendingWritesKey, resolvePendingWrite, setWriteApproval } from '../../lib/writeApprovals';
import { PendingWrites } from '../settings/PendingWrites';
import { attachReplyStats, loadReplyStats, saveReplyStats, statsFromUsage } from './replyStats';
import { ContextMeter, ReasoningChip, useReasoningEffort, REASONING_LEVELS } from './ChatStatus';
import { copyText } from '../../lib/clipboard';
import { compactNumber } from '../../lib/format';
import { CHAT_ACTION_EVENT, OPEN_PALETTE_EVENT, type ChatAction as HeaderAction } from '../../lib/events';

// --- Subcomponents -----------------------------------------------------------

/** Terminal colour codes in Hermes' command output. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function ThinkingRow() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2" role="status" aria-live="polite">
      <span className="yu-shimmer-agent text-sm">Thinking…</span>
    </div>
  );
}

function TranscriptItemView({
  item,
  runId,
  canRetry,
  onResolved,
  onRetry,
  onEdit,
}: {
  item: TranscriptItem;
  runId: string | null;
  canRetry: boolean;
  onResolved: (choice: string) => void;
  onRetry: () => void;
  onEdit: (text: string) => void;
}) {
  switch (item.kind) {
    case 'message':
      return item.role === 'user' ? (
        <UserMessage item={item} onEdit={onEdit} />
      ) : (
        <AssistantMessage item={item} canRetry={canRetry} onRetry={onRetry} />
      );
    case 'reasoning':
      return <ReasoningBlock reasoning={item} />;
    case 'system':
      return item.widget === 'memory-approvals' ? (
        <div className="mx-auto w-full max-w-3xl px-4 py-1" data-system-card>
          <p className="mb-2 text-[13px] font-medium text-text-primary">{item.title}</p>
          <PendingWrites subsystem="memory" showGate={false} />
        </div>
      ) : (
        <SystemCommandCard card={item} />
      );
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

// --- Chat view ---------------------------------------------------------------

/** Messages typed on "/" waiting for their new conversation's view to mount. */
const pendingFirstSends = new Map<string, { text: string; attachments: PendingAttachment[] }>();

type ChatAction =
  | { type: 'reset'; items: TranscriptItem[]; sessionId: string; force?: boolean }
  | { type: 'event'; frame: Parameters<typeof applyEvent>[1]; sessionId: string }
  | { type: 'appendUser'; text: string; attachments: MessageAttachment[]; sessionId: string }
  | {
      type: 'systemCard';
      id?: string;
      title: string;
      detail?: string;
      tone: 'info' | 'success' | 'warning';
      widget?: 'memory-approvals';
      mono?: boolean;
      pending?: boolean;
    }
  | { type: 'approvalResolved'; approvalId: string; choice: string }
  | { type: 'steer'; text: string }
  | { type: 'stats'; stats: ReplyStats }
  | { type: 'systemPatch'; id: string; title?: string; detail?: string; tone?: 'info' | 'success' | 'warning'; pending?: boolean };

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
          {
            kind: 'message',
            id: `local-${Date.now()}`,
            role: 'user',
            content: action.text,
            timestamp: Date.now() / 1000,
            ...(action.attachments.length > 0 ? { attachments: action.attachments } : {}),
          },
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
            id: action.id ?? `sys-${Date.now()}-${state.items.length}`,
            title: action.title,
            detail: action.detail,
            tone: action.tone,
            ...(action.widget !== undefined ? { widget: action.widget } : {}),
            ...(action.mono === true ? { mono: true } : {}),
            ...(action.pending === true ? { pending: true } : {}),
          },
        ],
      };
    }
    case 'systemPatch': {
      const patch = {
        ...(action.title !== undefined ? { title: action.title } : {}),
        ...(action.detail !== undefined ? { detail: action.detail } : {}),
        ...(action.tone !== undefined ? { tone: action.tone } : {}),
        ...(action.pending !== undefined ? { pending: action.pending } : {}),
      };
      return {
        ...state,
        items: state.items.map((item) => (item.kind === 'system' && item.id === action.id ? { ...item, ...patch } : item)),
      };
    }
    case 'steer':
      return appendSteer(state, action.text);
    case 'stats': {
      const index = state.items.map((item) => item.kind === 'message' && item.role === 'assistant').lastIndexOf(true);
      if (index === -1) return state;
      const items = [...state.items];
      const item = items[index];
      if (item?.kind === 'message') items[index] = { ...item, stats: action.stats };
      return { ...state, items };
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

  // Hermes titles a conversation after its first reply, a few seconds after
  // the run ends: refresh the sidebar and header now and once more later.
  const refreshSessionMeta = useCallback(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (sessionId !== undefined) void queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
    };
    refresh();
    window.setTimeout(refresh, 6000);
    window.setTimeout(refresh, 20000);
  }, [queryClient, sessionId]);

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

  const imagesQuery = useQuery({
    queryKey: ['session-images', sessionId],
    queryFn: () => fetchSessionImages(sessionId as string),
    enabled: sessionId !== undefined,
  });
  const storedImages = imagesQuery.data?.images;

  useEffect(() => {
    if (sessionId === undefined || !messagesQuery.data || imagesQuery.isPending) {
      return;
    }
    const items = attachReplyStats(historyToItems(messagesQuery.data.data, storedImages ?? []), loadReplyStats(sessionId));
    dispatch({ type: 'reset', items, sessionId, force: true });
  }, [sessionId, messagesQuery.data, storedImages, imagesQuery.isPending]);

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

  // Browser-side timings of the active run, for tokens per second.
  const timing = useRef<{ sentAt: number; firstDelta?: number; lastDelta?: number }>({ sentAt: 0 });
  const modelRef = useRef<string | undefined>(undefined);

  const handleEvent = useCallback(
    (frame: Parameters<typeof applyEvent>[1]) => {
      dispatch({ type: 'event', frame, sessionId: sessionId ?? '' });
      if (frame.type === 'message.delta') {
        const now = Date.now();
        timing.current.firstDelta ??= now;
        timing.current.lastDelta = now;
      }
      if (frame.type === 'run.completed' && sessionId !== undefined) {
        const { sentAt, firstDelta, lastDelta } = timing.current;
        const runtime = (frame as { runtime?: { model?: unknown } }).runtime;
        const stats = statsFromUsage(
          (frame as { usage?: unknown }).usage,
          {
            ...(firstDelta !== undefined ? { firstTokenMs: firstDelta - sentAt } : {}),
            ...(firstDelta !== undefined && lastDelta !== undefined ? { streamMs: lastDelta - firstDelta } : {}),
          },
          typeof runtime?.model === 'string' ? runtime.model : modelRef.current,
        );
        if (stats !== undefined) {
          dispatch({ type: 'stats', stats });
          saveReplyStats(sessionId, { ...stats, at: Date.now() });
        }
      }
      if (['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(frame.type)) {
        void queryClient.invalidateQueries({ queryKey: ['session-context', sessionId] });
        if (sessionId !== undefined) {
          saveActiveRunId(sessionId, null);
        }
        // Forget the run in state too: the history reload below resets the
        // transcript (runDone=false), and a still-set run id would make the
        // resume effect append the final output a second time.
        setActiveRunId(null);
        void queryClient.invalidateQueries({ queryKey: ['session-images', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
        refreshSessionMeta();
        notifyRunFinished(frame.type, frame.type === 'run.completed' ? String((frame as { output?: unknown }).output ?? '') : '');
      }
    },
    [sessionId, queryClient, refreshSessionMeta],
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
  const retryRef = useRef<() => void>(() => undefined);
  const running = activeRunId !== null && !transcript.runDone;
  const sendRef = useRef<(text: string, attachments?: PendingAttachment[], options?: { display?: string }) => Promise<void>>(
    async () => undefined,
  );

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
  const modelInfoQuery = useQuery({ queryKey: ['model-info'], queryFn: fetchModelInfo, staleTime: 60_000 });
  const contextQuery = useQuery({
    queryKey: ['session-context', sessionId],
    queryFn: () => fetchSessionContext(sessionId as string),
    enabled: sessionId !== undefined,
    staleTime: 15_000,
    retry: false,
  });
  const currentModel = sessionModelQuery.data?.model ?? null;
  const currentProvider = sessionModelQuery.data?.provider ?? '';
  const defaultModel = modelInfoQuery.data?.model ?? null;
  const defaultProvider = modelInfoQuery.data?.provider ?? '';
  const effectiveModel = currentModel ?? defaultModel;
  useEffect(() => {
    modelRef.current = effectiveModel ?? undefined;
  }, [effectiveModel]);
  const modelLabel = effectiveModel ?? 'Model';
  const modelHint =
    currentModel !== null
      ? `${currentModel}${currentProvider !== '' ? ` (${currentProvider})` : ''}: picked for this chat only. Click to change.`
      : defaultModel !== null
        ? `${defaultModel}${defaultProvider !== '' ? ` (${defaultProvider})` : ''}: Hermes' default model (Settings > Models). Click to pick another one for this chat only.`
        : 'Change the model for this chat';
  const reasoning = useReasoningEffort();
  const stop = async () => {
    if (activeRunId === null) return;
    try {
      await stopRun(activeRunId);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Stop failed.');
    }
  };

  // A message sent while the agent works is a steer: shown at once as your
  // message (Hermes reads it at its next step, in the same run).
  const steer = async (text: string) => {
    if (activeRunId === null) return;
    dispatch({ type: 'steer', text });
    try {
      await steerRun(activeRunId, text);
    } catch (steerError) {
      setError(steerError instanceof Error ? `Hermes did not take that message: ${steerError.message}` : 'Steer failed.');
    }
  };

  // Messages queued with /queue while a run is active go out when it ends.
  const [queued, setQueued] = useState<string[]>([]);

  const runInHermes = useCallback(
    (commandText: string) => {
      const id = `cmd-${Date.now()}`;
      const head = commandText.split(/\s+/)[0] ?? commandText;
      dispatch({ type: 'systemCard', id, title: commandText.length > 60 ? head : commandText, detail: 'Running in Hermes…', tone: 'info', mono: true, pending: true });
      void execHermesCommand(commandText, sessionId)
        .then((result) => {
          if (result.kind === 'output') {
            dispatch({
              type: 'systemPatch',
              id,
              pending: false,
              detail: stripAnsi(result.output) + (result.warning ? `\n\n⚠ ${result.warning}` : ''),
              tone: result.warning ? 'warning' : 'info',
            });
            // Commands can change config (model, personality, reasoning...).
            void queryClient.invalidateQueries({ queryKey: ['settings-config'] });
            void queryClient.invalidateQueries({ queryKey: ['model-info'] });
          } else if (result.kind === 'send') {
            dispatch({ type: 'systemPatch', id, pending: false, detail: result.notice ?? 'Hermes turned this into a message; sending it now.' });
            void sendRef.current(result.message, [], { display: commandText });
          } else if (result.kind === 'prefill') {
            dispatch({ type: 'systemPatch', id, pending: false, detail: result.notice ?? 'Put into the composer: edit and send.' });
            insertIntoComposer(result.message);
          } else {
            dispatch({ type: 'systemPatch', id, pending: false, tone: 'warning', detail: result.message });
          }
        })
        .catch((error: unknown) =>
          dispatch({
            type: 'systemPatch',
            id,
            pending: false,
            tone: 'warning',
            detail: error instanceof Error ? error.message : 'Hermes did not answer.',
          }),
        );
    },
    [sessionId, queryClient],
  );

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
          void Promise.all([fetchAppStatus(), sessionId !== undefined ? fetchSessionContext(sessionId).catch(() => null) : null])
            .then(([status, context]) => {
              const version = 'version' in status.hermes ? ` (v${status.hermes.version})` : '';
              const model =
                currentModel !== null
                  ? `${currentProvider !== '' ? `${currentProvider}/` : ''}${currentModel} (this chat)`
                  : defaultModel !== null
                    ? `${defaultProvider !== '' ? `${defaultProvider}/` : ''}${defaultModel} (Hermes default)`
                    : 'unknown';
              const lines = [
                `Gateway:    ${status.hermes.state}${version}`,
                `WebUI:      v${status.version}`,
                `Model:      ${model}`,
                `Reasoning:  ${reasoning.level ?? 'default'}`,
              ];
              if (context !== null && context !== undefined) {
                if (context.used !== null) {
                  lines.push(
                    `Context:    ${context.used.toLocaleString()}${context.contextLength ? ` / ${context.contextLength.toLocaleString()} (${((context.used / context.contextLength) * 100).toFixed(1)}%)` : ' tokens'}`,
                  );
                }
                lines.push(
                  `Tokens:     ${compactNumber(context.input ?? 0)} in · ${compactNumber(context.output ?? 0)} out · ${compactNumber(context.cacheRead ?? 0)} cached`,
                  `Messages:   ${context.messages ?? 0} · API calls ${context.apiCalls ?? 0}`,
                );
              }
              lines.push(`Session:    ${sessionId ?? '(new chat, not created yet)'}`, `Run:        ${activeRunId !== null && !transcript.runDone ? 'working' : 'idle'}`);
              dispatch({ type: 'systemCard', title: 'Hermes status', detail: lines.join('\n'), tone: 'info', mono: true });
            })
            .catch(() => notice('Hermes status', 'Status unavailable.', 'warning'));
          return;
        }
        case 'context-card':
        case 'usage-card': {
          if (sessionId === undefined) {
            notice(cmd.handler === 'usage-card' ? 'Token usage' : 'Context', 'Nothing yet: send a message first.');
            return;
          }
          void fetchSessionContext(sessionId)
            .then((context) => {
              const pct = context.used !== null && context.contextLength ? (context.used / context.contextLength) * 100 : null;
              const lines =
                cmd.handler === 'usage-card'
                  ? [
                      `Model:            ${context.model ?? 'unknown'}`,
                      `Input tokens:     ${(context.input ?? 0).toLocaleString()}`,
                      `Output tokens:    ${(context.output ?? 0).toLocaleString()}`,
                      `Cache read:       ${(context.cacheRead ?? 0).toLocaleString()}`,
                      `Cache write:      ${(context.cacheWrite ?? 0).toLocaleString()}`,
                      ...(context.reasoning ? [`Reasoning tokens: ${context.reasoning.toLocaleString()}`] : []),
                      `API calls:        ${(context.apiCalls ?? 0).toLocaleString()}`,
                      ...(context.cost !== null && context.cost > 0 ? [`Cost (approx.):   $${context.cost.toFixed(4)}`] : []),
                    ]
                  : [
                      `Conversation: ${context.messages ?? 0} messages`,
                      `Model: ${context.model ?? 'unknown'}`,
                      context.used !== null
                        ? `Context usage: ${context.used.toLocaleString()}${context.contextLength ? ` / ${context.contextLength.toLocaleString()} tokens (${pct?.toFixed(1)}%)` : ' tokens'}`
                        : 'Context usage: not measured yet (after the first reply)',
                      'Hermes compresses older turns when the window gets close to full; /compress does it now.',
                    ];
              dispatch({
                type: 'systemCard',
                title: cmd.handler === 'usage-card' ? 'Session token usage' : 'Context',
                detail: lines.join('\n'),
                tone: 'info',
                mono: true,
              });
            })
            .catch((error: unknown) => notice('Context unavailable', error instanceof Error ? error.message : 'Unknown error.', 'warning'));
          return;
        }
        case 'reasoning': {
          const level = argsText.trim().toLowerCase().replace(/\s*--global$/, '');
          if (level === '') {
            notice('Reasoning effort', `Current: ${reasoning.level ?? 'default'}.\nUse /reasoning <${REASONING_LEVELS.join('|')}>, or the brain chip under the composer.`);
            return;
          }
          if ((REASONING_LEVELS as readonly string[]).includes(level)) {
            reasoning.set(level);
            return;
          }
          // show/hide/full/clamp are about Hermes' own display: let Hermes answer.
          runInHermes(`/reasoning ${argsText.trim()}`);
          return;
        }
        case 'retry-last':
          if (running) notice('Still working', 'Wait for the current reply, or /stop it first.', 'warning');
          else retryRef.current();
          return;
        case 'rename-session':
        case 'fork-session':
        case 'export-session': {
          if (sessionId === undefined) {
            notice('No conversation yet', 'Send a message first.', 'warning');
            return;
          }
          const action: HeaderAction = cmd.handler === 'rename-session' ? 'rename' : cmd.handler === 'fork-session' ? 'fork' : 'export';
          window.dispatchEvent(new CustomEvent(CHAT_ACTION_EVENT, { detail: { action, arg: argsText } }));
          return;
        }
        case 'copy-last': {
          const last = [...transcript.items].reverse().find((item) => item.kind === 'message' && item.role === 'assistant');
          if (last?.kind !== 'message') {
            notice('Nothing to copy', 'There is no reply yet.', 'warning');
            return;
          }
          void copyText(last.content)
            .then(() => notice('Copied', 'The last reply is on your clipboard.', 'success'))
            .catch(() => notice('Copy failed', 'The clipboard is not available.', 'warning'));
          return;
        }
        case 'steer': {
          const text = argsText.trim();
          if (text === '') {
            notice('Steer', 'Usage: /steer <message>. Or just type while Hermes is working.', 'warning');
          } else if (running) {
            void steer(text);
          } else {
            void sendRef.current(text);
          }
          return;
        }
        case 'queue': {
          const text = argsText.trim();
          if (text === '') {
            notice('Queue', 'Usage: /queue <message>: sent when the current reply finishes.', 'warning');
          } else if (running) {
            setQueued((list) => [...list, text]);
            notice('Queued', `Sent when Hermes finishes: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`, 'success');
          } else {
            void sendRef.current(text);
          }
          return;
        }
        case 'attach':
          window.dispatchEvent(new CustomEvent('hermes-webui:composer-attach'));
          return;
        case 'open-palette':
          window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
          return;
        case 'navigate-appearance':
          void navigate({ to: '/settings/appearance' });
          return;
        case 'voice':
          notice('Voice', 'Use the microphone button in the composer: Hermes transcribes what you say. Read aloud is under each reply.');
          return;
        case 'open-sessions':
          window.dispatchEvent(new CustomEvent('hermes-webui:open-sessions'));
          return;
        case 'navigate-settings':
          void navigate({ to: '/settings' });
          return;
        case 'navigate-skills':
          if (argsText.trim() !== '') runInHermes(`/skills ${argsText.trim()}`);
          else void navigate({ to: '/settings/skills' });
          return;
        case 'memory-approvals': {
          // Same grammar as Hermes: /memory [pending|approve|reject|approval] [id|all|on|off]
          const [sub = 'pending', arg = ''] = argsText.trim().split(/\s+/).filter((part) => part !== '');
          const verb = sub.toLowerCase();
          if (verb === 'pending' || verb === 'list') {
            dispatch({ type: 'systemCard', title: 'Pending memory writes', tone: 'info', widget: 'memory-approvals' });
            return;
          }
          if (verb === 'approve' || verb === 'apply' || verb === 'reject' || verb === 'deny' || verb === 'drop') {
            const action = verb === 'approve' || verb === 'apply' ? 'approve' : 'reject';
            if (arg === '') {
              notice('Which write?', `Usage: /memory ${action} <id|all>. Type /memory to see what is pending.`, 'warning');
              return;
            }
            void resolvePendingWrite('memory', arg, action)
              .then((result) => {
                notice(action === 'approve' ? 'Memory approval' : 'Memory rejection', result.message, result.ok ? 'success' : 'warning');
                void queryClient.invalidateQueries({ queryKey: pendingWritesKey('memory') });
              })
              .catch((error: unknown) =>
                notice('Memory approvals unavailable', error instanceof Error ? error.message : 'Unknown error.', 'warning'),
              );
            return;
          }
          if (verb === 'approval' || verb === 'mode') {
            const value = arg.toLowerCase();
            const enabled = ['on', 'true', 'yes', '1', 'enable', 'enabled'].includes(value)
              ? true
              : ['off', 'false', 'no', '0', 'disable', 'disabled'].includes(value)
                ? false
                : null;
            if (enabled === null) {
              notice('Memory approval gate', 'Usage: /memory approval <on|off>', 'warning');
              return;
            }
            void setWriteApproval('memory', enabled)
              .then(() => {
                notice('Memory approval gate', enabled ? 'On: Hermes asks before saving memories.' : 'Off: Hermes saves memories directly.', 'success');
                void queryClient.invalidateQueries({ queryKey: pendingWritesKey('memory') });
              })
              .catch((error: unknown) =>
                notice('Could not change the gate', error instanceof Error ? error.message : 'Unknown error.', 'warning'),
              );
            return;
          }
          notice('Unknown /memory subcommand', 'Use: pending, approve <id|all>, reject <id|all>, approval <on|off>.', 'warning');
          return;
        }
        case 'stop-run':
          if (activeRunId !== null && !transcript.runDone) {
            void stop();
            notice('Stop requested', 'The active run is being stopped.');
          } else {
            notice('No active run', 'There is no run to stop in this session.', 'warning');
          }
          return;
        case 'help-card': {
          const all = commandsQuery.data?.commands ?? [];
          const count = (kind: string) => all.filter((item) => item.availability === kind).length;
          notice(
            'Hermes commands',
            `Type "/" to browse them all. ${count('native')} run right here in the WebUI, ${count('hermes')} run inside Hermes (same output as the terminal), ${count('unsupported')} only make sense in a terminal.\nSkill commands (like /<skill-name>) work too.`,
          );
          return;
        }
        default:
          if (cmd.availability === 'hermes') {
            runInHermes(`${cmd.name}${argsText.trim() !== '' ? ` ${argsText.trim()}` : ''}`);
            return;
          }
          notice(
            `${cmd.name} is for the terminal`,
            cmd.disabledReason ?? 'This Hermes command only makes sense in the terminal app.',
            'warning',
          );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRunId, transcript.runDone, transcript.items, commandsQuery.data, currentModel, currentProvider, defaultModel, defaultProvider, reasoning, runInHermes, sessionId, queryClient],
  );

  const send = async (text: string, attachments: PendingAttachment[] = [], options: { display?: string } = {}) => {
    if (sending) return;
    // Command interception: catalog commands run natively or in Hermes; any
    // other "/word" goes to Hermes too (skill and plugin commands). None of
    // them becomes a user message as typed.
    if (attachments.length === 0 && options.display === undefined) {
      const command = findCommandIn(commandsQuery.data?.commands ?? [], text);
      if (command !== undefined) {
        runCommand(command, commandArgs(text));
        return;
      }
      if (/^\/[a-z0-9][\w:.-]*(\s|$)/i.test(text)) {
        runInHermes(text.trim());
        return;
      }
    }
    setError(null);
    setSending(true);
    try {
      // Placeholder name shown until Hermes titles the conversation (never a
      // file name: an upload is not what the conversation is about).
      const first = attachments[0];
      const titleSeed =
        text !== ''
          ? text
          : first?.kind === 'image'
            ? 'Image'
            : first?.upload?.kind === 'audio'
              ? 'Audio'
              : first?.upload?.kind === 'video'
                ? 'Video'
                : 'File';
      if (sessionId === undefined) {
        // A conversation exists only once something is sent: create it now and
        // hand the message to that conversation's own view.
        // No title: Hermes names the conversation itself after the first
        // reply (as on Telegram). A title set here counts as the user's
        // choice and Hermes would never replace it.
        const created = await createSession({});
        rememberDerivedTitle(created.session.id, titleSeed);
        pendingFirstSends.set(created.session.id, { text, attachments });
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
        return;
      }
      const targetSession = sessionId;
      rememberDerivedTitle(targetSession, titleSeed);
      dispatch({
        type: 'appendUser',
        text: options.display ?? text,
        attachments: attachments.map((item) =>
          item.kind === 'image'
            ? { kind: 'image' as const, name: item.name, url: item.dataUrl }
            : item.upload !== undefined
              ? { kind: 'file' as const, name: item.name, url: item.upload.url, media: item.upload.kind }
              : { kind: 'file' as const, name: item.name },
        ),
        sessionId: targetSession,
      });
      timing.current = { sentAt: Date.now() };
      const run = await createRun(buildRunInput(text, attachments), targetSession);
      saveActiveRunId(targetSession, run.run_id);
      setActiveRunId(run.run_id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to start the run.');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    sendRef.current = send;
  });

  // The first message of a conversation started on "/" is sent from here,
  // once the (empty) history has loaded so the reset cannot drop it.
  useEffect(() => {
    if (sessionId === undefined || !messagesQuery.data || imagesQuery.isPending) return;
    if (!pendingFirstSends.has(sessionId)) return;
    // Deferred (not a synchronous setState in the effect); taken inside the
    // timer so a StrictMode remount cannot drop it.
    const timer = window.setTimeout(() => {
      const pending = pendingFirstSends.get(sessionId);
      if (pending === undefined) return;
      pendingFirstSends.delete(sessionId);
      void send(pending.text, pending.attachments);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messagesQuery.data, imagesQuery.isPending]);

  // Retry re-sends the last user turn (images included) as a new run.
  const lastUser = [...transcript.items]
    .reverse()
    .find((item): item is Extract<TranscriptItem, { kind: 'message' }> => item.kind === 'message' && item.role === 'user');
  const lastAssistantId = [...transcript.items]
    .reverse()
    .find((item) => item.kind === 'message' && item.role === 'assistant')?.id;
  const retry = () => {
    if (lastUser === undefined) return;
    const images: PendingAttachment[] = (lastUser.attachments ?? [])
      .filter((item) => item.kind === 'image' && item.url !== undefined)
      .map((item, index) => ({ id: `retry-${index}`, kind: 'image', name: item.name, size: 0, dataUrl: item.url }));
    void send(lastUser.content, images);
  };
  useEffect(() => {
    retryRef.current = retry;
  });

  // /queue: the next queued message goes out once the reply is done.
  useEffect(() => {
    if (running || sending || queued.length === 0) return;
    const timer = window.setTimeout(() => {
      const [next, ...rest] = queued;
      setQueued(rest);
      if (next !== undefined) void sendRef.current(next);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [running, sending, queued]);
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
    <div data-chat-surface className="relative flex h-full min-h-0 flex-col bg-background">
      {sessionId !== undefined ? <ChatHeader sessionId={sessionId} items={transcript.items} /> : null}
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
              canRetry={!running && !sending && item.id === lastAssistantId && lastUser !== undefined}
              onResolved={(choice) =>
                dispatch({ type: 'approvalResolved', approvalId: item.id, choice })
              }
              onRetry={retry}
              onEdit={insertIntoComposer}
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
        {queued.length > 0 ? (
          <p className="mb-2 px-1 text-xs text-text-tertiary" data-tip={queued.join('\n\n')} data-tip-wide>
            {queued.length} message{queued.length > 1 ? 's' : ''} queued for when Hermes finishes.
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
          onSend={(text, attachments) => void send(text, attachments)}
          onSteer={running ? (text) => void steer(text) : undefined}
          onCommand={(cmd, args) => runCommand(cmd, args)}
          onOpenModelPicker={() => setPickerOpen(true)}
          modelLabel={modelLabel}
          modelHint={modelHint}
          extras={
            <>
              <ReasoningChip />
              <ContextMeter info={contextQuery.data} />
            </>
          }
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
