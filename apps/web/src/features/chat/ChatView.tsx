import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
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
  fetchSessions,
  stopRun,
  steerRun,
} from '../../lib/api';
import { rememberDerivedTitle } from '../../lib/sessionTitles';
import { DotMatrixLoader } from '../../components/DotMatrixLoader';
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
import {
  CHAT_ACTION_EVENT,
  OPEN_PALETTE_EVENT,
  type ChatAction as HeaderAction,
} from '../../lib/events';

// --- Subcomponents -----------------------------------------------------------

/** Terminal colour codes in Hermes' command output. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function ThinkingRow() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <DotMatrixLoader agent />
        <span className="yu-shimmer-agent text-sm">{t('chat.thinking')}</span>
      </div>
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
          <p className="border-l border-border-strong pl-3.5 text-[13px] text-text-secondary italic">
            {item.text}
          </p>
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
  | {
      type: 'systemPatch';
      id: string;
      title?: string;
      detail?: string;
      tone?: 'info' | 'success' | 'warning';
      pending?: boolean;
    };

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
        items: state.items.map((item) =>
          item.kind === 'system' && item.id === action.id ? { ...item, ...patch } : item,
        ),
      };
    }
    case 'steer':
      return appendSteer(state, action.text);
    case 'stats': {
      const index = state.items
        .map((item) => item.kind === 'message' && item.role === 'assistant')
        .lastIndexOf(true);
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
  const { t } = useTranslation();
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
      if (sessionId !== undefined)
        void queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
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
    // Cross-surface live sync: the gateway writes Telegram (and other platform)
    // messages into the same store this query reads, so a short poll keeps an
    // open chat current without any run-scoped SSE. Duplicates are impossible:
    // the response is a full reset keyed by stable row ids.
    refetchInterval: 2000,
  });

  // The session's originating surface (telegram, webui, ...), used to warn
  // when a Hermes command is better run natively on that surface.
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(80),
    enabled: sessionId !== undefined,
    staleTime: 10_000,
  });
  const sessionSource = sessionsQuery.data?.data.find((row) => row.id === sessionId)?.source;

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
    const items = attachReplyStats(
      historyToItems(messagesQuery.data.data, storedImages ?? []),
      loadReplyStats(sessionId),
    );
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
        if (
          status.completed ||
          ['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)
        ) {
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
          if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)) {
            dispatch({
              type: 'event',
              frame:
                status.status === 'failed'
                  ? {
                      type: 'run.failed',
                      runId: activeRunId,
                      error: status.error ?? t('chat.view.runFailed'),
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
  }, [sessionId, activeRunId, transcript.runDone, queryClient, t]);

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
            ...(firstDelta !== undefined && lastDelta !== undefined
              ? { streamMs: lastDelta - firstDelta }
              : {}),
          },
          typeof runtime?.model === 'string' ? runtime.model : modelRef.current,
        );
        if (stats !== undefined) {
          dispatch({ type: 'stats', stats });
          saveReplyStats(sessionId, { ...stats, at: Date.now() });
        }
      }
      if (
        ['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(frame.type)
      ) {
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
        notifyRunFinished(
          frame.type,
          frame.type === 'run.completed'
            ? String((frame as { output?: unknown }).output ?? '')
            : '',
        );
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
  const sendRef = useRef<
    (
      text: string,
      attachments?: PendingAttachment[],
      options?: { display?: string },
    ) => Promise<void>
  >(async () => undefined);

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
  const modelInfoQuery = useQuery({
    queryKey: ['model-info'],
    queryFn: fetchModelInfo,
    staleTime: 60_000,
  });
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
  const modelLabel = effectiveModel ?? t('chat.model');
  const modelHint =
    currentModel !== null
      ? t('chat.view.modelHintLocked', {
          model: `${currentModel}${currentProvider !== '' ? ` (${currentProvider})` : ''}`,
        })
      : defaultModel !== null
        ? t('chat.view.modelHintDefault', {
            model: `${defaultModel}${defaultProvider !== '' ? ` (${defaultProvider})` : ''}`,
          })
        : t('chat.view.modelHintNone');
  const reasoning = useReasoningEffort();
  const stop = async () => {
    if (activeRunId === null) return;
    try {
      await stopRun(activeRunId);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : t('chat.view.stopFailed'));
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
      setError(
        steerError instanceof Error
          ? t('chat.view.steerRejected', { message: steerError.message })
          : t('chat.view.steerFailed'),
      );
    }
  };

  // Messages queued with /queue while a run is active go out when it ends.
  const [queued, setQueued] = useState<string[]>([]);

  const runInHermes = useCallback(
    (commandText: string) => {
      const id = `cmd-${Date.now()}`;
      const head = commandText.split(/\s+/)[0] ?? commandText;
      dispatch({
        type: 'systemCard',
        id,
        title: commandText.length > 60 ? head : commandText,
        detail: t('chat.view.runningInHermes'),
        tone: 'info',
        mono: true,
        pending: true,
      });
      void execHermesCommand(commandText, sessionId)
        .then((result) => {
          if (result.kind === 'output') {
            const output = stripAnsi(result.output);
            const emptyOutput = output.trim() === '' || output.trim() === '(no output)';
            // A session born on another surface (telegram, discord, ...) is
            // owned by that surface's process: mutative commands like /compress
            // dispatched from here can be a silent no-op on the live
            // conversation, so an empty result gets an explanatory warning.
            const foreignOwned = sessionSource !== undefined && sessionSource !== 'webui';
            const noEffect = emptyOutput && foreignOwned;
            dispatch({
              type: 'systemPatch',
              id,
              pending: false,
              detail: noEffect
                ? t('chat.view.foreignCommandNoOutput', { source: sessionSource })
                : output + (result.warning ? `\n\n⚠ ${result.warning}` : ''),
              tone: noEffect || result.warning ? 'warning' : 'info',
            });
            // Commands can change config (model, personality, reasoning...).
            void queryClient.invalidateQueries({ queryKey: ['settings-config'] });
            void queryClient.invalidateQueries({ queryKey: ['model-info'] });
          } else if (result.kind === 'send') {
            dispatch({
              type: 'systemPatch',
              id,
              pending: false,
              detail: result.notice ?? t('chat.view.commandTurnedIntoMessage'),
            });
            void sendRef.current(result.message, [], { display: commandText });
          } else if (result.kind === 'prefill') {
            dispatch({
              type: 'systemPatch',
              id,
              pending: false,
              detail: result.notice ?? t('chat.view.commandPrefilled'),
            });
            insertIntoComposer(result.message);
          } else {
            dispatch({
              type: 'systemPatch',
              id,
              pending: false,
              tone: 'warning',
              detail: result.message,
            });
          }
        })
        .catch((error: unknown) =>
          dispatch({
            type: 'systemPatch',
            id,
            pending: false,
            tone: 'warning',
            detail: error instanceof Error ? error.message : t('chat.view.hermesDidNotAnswer'),
          }),
        );
    },
    [sessionId, queryClient, t],
  );

  const runCommand = useCallback(
    (cmd: NormalizedCommand, argsText: string) => {
      const notice = (
        title: string,
        detail: string,
        tone: 'info' | 'success' | 'warning' = 'info',
      ) => dispatch({ type: 'systemCard', title, detail, tone });
      switch (cmd.handler) {
        case 'new-chat': {
          const created = createSession(
            argsText.trim() === '' ? {} : { title: argsText.trim().slice(0, 60) },
          );
          void created
            .then((result) => {
              void navigate({ to: '/chat/$sessionId', params: { sessionId: result.session.id } });
              notice(
                t('chat.view.newChatStarted'),
                t('chat.view.newChatSession', { id: result.session.id }),
                'success',
              );
            })
            .catch((error: unknown) =>
              notice(
                t('chat.view.newChatFailed'),
                error instanceof Error ? error.message : t('chat.view.unknownError'),
                'warning',
              ),
            );
          return;
        }
        case 'model-picker':
          setPickerOpen(true);
          return;
        case 'status-card': {
          void Promise.all([
            fetchAppStatus(),
            sessionId !== undefined ? fetchSessionContext(sessionId).catch(() => null) : null,
          ])
            .then(([status, context]) => {
              const version = 'version' in status.hermes ? ` (v${status.hermes.version})` : '';
              const model =
                currentModel !== null
                  ? `${currentProvider !== '' ? `${currentProvider}/` : ''}${currentModel}${t('chat.view.thisChat')}`
                  : defaultModel !== null
                    ? `${defaultProvider !== '' ? `${defaultProvider}/` : ''}${defaultModel}${t('chat.view.hermesDefault')}`
                    : 'unknown';
              const lines = [
                t('chat.view.statusGateway', { state: status.hermes.state, version }),
                t('chat.view.statusWebui', { version: status.version }),
                t('chat.view.statusModel', { model }),
                t('chat.view.statusReasoning', { level: reasoning.level ?? 'default' }),
              ];
              if (context !== null && context !== undefined) {
                if (context.used !== null) {
                  const used = context.used.toLocaleString();
                  const rest = context.contextLength
                    ? ` / ${context.contextLength.toLocaleString()} (${((context.used / context.contextLength) * 100).toFixed(1)}%)`
                    : ' tokens';
                  lines.push(t('chat.view.statusContext', { used, rest }));
                }
                lines.push(
                  t('chat.view.statusTokens', {
                    input: compactNumber(context.input ?? 0),
                    output: compactNumber(context.output ?? 0),
                    cache: compactNumber(context.cacheRead ?? 0),
                  }),
                  t('chat.view.statusMessages', {
                    count: context.messages ?? 0,
                    calls: context.apiCalls ?? 0,
                  }),
                );
              }
              lines.push(
                t('chat.view.statusSession', { id: sessionId ?? t('chat.view.statusSessionNew') }),
                t('chat.view.statusRun', {
                  state: activeRunId !== null && !transcript.runDone ? 'working' : 'idle',
                }),
              );
              dispatch({
                type: 'systemCard',
                title: t('chat.view.statusTitle'),
                detail: lines.join('\n'),
                tone: 'info',
                mono: true,
              });
            })
            .catch(() =>
              notice(t('chat.view.statusTitle'), t('chat.view.statusUnavailable'), 'warning'),
            );
          return;
        }
        case 'context-card':
        case 'usage-card': {
          if (sessionId === undefined) {
            notice(
              cmd.handler === 'usage-card' ? t('chat.view.tokenUsage') : t('chat.view.context'),
              t('chat.view.nothingYet'),
            );
            return;
          }
          void fetchSessionContext(sessionId)
            .then((context) => {
              const pct =
                context.used !== null && context.contextLength
                  ? (context.used / context.contextLength) * 100
                  : null;
              const lines =
                cmd.handler === 'usage-card'
                  ? [
                      t('chat.view.usageModel', { model: context.model ?? 'unknown' }),
                      t('chat.view.usageInput', { count: (context.input ?? 0).toLocaleString() }),
                      t('chat.view.usageOutput', { count: (context.output ?? 0).toLocaleString() }),
                      t('chat.view.usageCacheRead', {
                        count: (context.cacheRead ?? 0).toLocaleString(),
                      }),
                      t('chat.view.usageCacheWrite', {
                        count: (context.cacheWrite ?? 0).toLocaleString(),
                      }),
                      ...(context.reasoning
                        ? [
                            t('chat.view.usageReasoning', {
                              count: context.reasoning.toLocaleString(),
                            }),
                          ]
                        : []),
                      t('chat.view.usageApiCalls', {
                        count: (context.apiCalls ?? 0).toLocaleString(),
                      }),
                      ...(context.cost !== null && context.cost > 0
                        ? [t('chat.view.usageCost', { cost: context.cost.toFixed(4) })]
                        : []),
                    ]
                  : [
                      t('chat.view.contextConversation', { count: context.messages ?? 0 }),
                      t('chat.view.contextModel', { model: context.model ?? 'unknown' }),
                      context.used !== null
                        ? t('chat.view.contextUsage', {
                            used: context.used.toLocaleString(),
                            rest: context.contextLength
                              ? ` / ${context.contextLength.toLocaleString()} tokens (${pct?.toFixed(1)}%)`
                              : ' tokens',
                          })
                        : t('chat.view.contextUsageNotMeasured'),
                      t('chat.view.contextCompress'),
                    ];
              dispatch({
                type: 'systemCard',
                title:
                  cmd.handler === 'usage-card'
                    ? t('chat.view.sessionTokenUsage')
                    : t('chat.view.context'),
                detail: lines.join('\n'),
                tone: 'info',
                mono: true,
              });
            })
            .catch((error: unknown) =>
              notice(
                t('chat.view.contextUnavailable'),
                error instanceof Error ? error.message : t('chat.view.unknownError'),
                'warning',
              ),
            );
          return;
        }
        case 'reasoning': {
          const level = argsText
            .trim()
            .toLowerCase()
            .replace(/\s*--global$/, '');
          if (level === '') {
            notice(
              t('chat.view.reasoningEffort'),
              t('chat.view.reasoningCurrent', {
                level: reasoning.level ?? 'default',
                levels: REASONING_LEVELS.join('|'),
              }),
            );
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
          if (running)
            notice(t('chat.view.stillWorking'), t('chat.view.stillWorkingTip'), 'warning');
          else retryRef.current();
          return;
        case 'rename-session':
        case 'fork-session':
        case 'export-session': {
          if (sessionId === undefined) {
            notice(t('chat.view.noConversationYet'), t('chat.view.sendFirstMessage'), 'warning');
            return;
          }
          const action: HeaderAction =
            cmd.handler === 'rename-session'
              ? 'rename'
              : cmd.handler === 'fork-session'
                ? 'fork'
                : 'export';
          window.dispatchEvent(
            new CustomEvent(CHAT_ACTION_EVENT, { detail: { action, arg: argsText } }),
          );
          return;
        }
        case 'copy-last': {
          const last = [...transcript.items]
            .reverse()
            .find((item) => item.kind === 'message' && item.role === 'assistant');
          if (last?.kind !== 'message') {
            notice(t('chat.view.nothingToCopy'), t('chat.view.noReplyYet'), 'warning');
            return;
          }
          void copyText(last.content)
            .then(() => notice(t('common.copied'), t('chat.view.copiedLastReply'), 'success'))
            .catch(() =>
              notice(t('chat.view.copyFailedTitle'), t('chat.view.copyFailedBody'), 'warning'),
            );
          return;
        }
        case 'steer': {
          const text = argsText.trim();
          if (text === '') {
            notice(t('chat.view.steerTitle'), t('chat.view.steerUsage'), 'warning');
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
            notice(t('chat.view.queueTitle'), t('chat.view.queueUsage'), 'warning');
          } else if (running) {
            setQueued((list) => [...list, text]);
            notice(
              t('chat.view.queuedTitle'),
              t('chat.view.queued', { text: text.length > 80 ? `${text.slice(0, 80)}…` : text }),
              'success',
            );
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
          notice(t('chat.view.voiceTitle'), t('chat.view.voiceTip'));
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
          const [sub = 'pending', arg = ''] = argsText
            .trim()
            .split(/\s+/)
            .filter((part) => part !== '');
          const verb = sub.toLowerCase();
          if (verb === 'pending' || verb === 'list') {
            dispatch({
              type: 'systemCard',
              title: t('chat.view.pendingMemoryWrites'),
              tone: 'info',
              widget: 'memory-approvals',
            });
            return;
          }
          if (
            verb === 'approve' ||
            verb === 'apply' ||
            verb === 'reject' ||
            verb === 'deny' ||
            verb === 'drop'
          ) {
            const action = verb === 'approve' || verb === 'apply' ? 'approve' : 'reject';
            if (arg === '') {
              notice(t('chat.view.whichWrite'), t('chat.view.memoryUsage', { action }), 'warning');
              return;
            }
            void resolvePendingWrite('memory', arg, action)
              .then((result) => {
                notice(
                  action === 'approve'
                    ? t('chat.view.memoryApproval')
                    : t('chat.view.memoryRejection'),
                  result.message,
                  result.ok ? 'success' : 'warning',
                );
                void queryClient.invalidateQueries({ queryKey: pendingWritesKey('memory') });
              })
              .catch((error: unknown) =>
                notice(
                  t('chat.view.memoryApprovalsUnavailable'),
                  error instanceof Error ? error.message : t('chat.view.unknownError'),
                  'warning',
                ),
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
              notice(t('chat.view.memoryGate'), t('chat.view.memoryGateUsage'), 'warning');
              return;
            }
            void setWriteApproval('memory', enabled)
              .then(() => {
                notice(
                  t('chat.view.memoryGate'),
                  enabled ? t('chat.view.memoryGateOn') : t('chat.view.memoryGateOff'),
                  'success',
                );
                void queryClient.invalidateQueries({ queryKey: pendingWritesKey('memory') });
              })
              .catch((error: unknown) =>
                notice(
                  t('chat.view.gateChangeFailed'),
                  error instanceof Error ? error.message : t('chat.view.unknownError'),
                  'warning',
                ),
              );
            return;
          }
          notice(t('chat.view.memoryUnknown'), t('chat.view.memoryHelp'), 'warning');
          return;
        }
        case 'stop-run':
          if (activeRunId !== null && !transcript.runDone) {
            void stop();
            notice(t('chat.view.stopRequested'), t('chat.view.stopRequestedTip'));
          } else {
            notice(t('chat.view.noActiveRun'), t('chat.view.noActiveRunTip'), 'warning');
          }
          return;
        case 'help-card': {
          const all = commandsQuery.data?.commands ?? [];
          const count = (kind: string) => all.filter((item) => item.availability === kind).length;
          notice(
            t('chat.hermesCommands'),
            t('chat.view.helpBody', {
              native: count('native'),
              hermes: count('hermes'),
              unsupported: count('unsupported'),
            }),
          );
          return;
        }
        default:
          if (cmd.availability === 'hermes') {
            runInHermes(`${cmd.name}${argsText.trim() !== '' ? ` ${argsText.trim()}` : ''}`);
            return;
          }
          notice(
            t('chat.view.terminalOnly', { command: cmd.name }),
            cmd.disabledReason ?? t('chat.view.terminalOnlyReason'),
            'warning',
          );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeRunId,
      transcript.runDone,
      transcript.items,
      commandsQuery.data,
      currentModel,
      currentProvider,
      defaultModel,
      defaultProvider,
      reasoning,
      runInHermes,
      sessionId,
      queryClient,
    ],
  );

  const send = async (
    text: string,
    attachments: PendingAttachment[] = [],
    options: { display?: string } = {},
  ) => {
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
            ? t('chat.view.titleImage')
            : first?.upload?.kind === 'audio'
              ? t('chat.view.titleAudio')
              : first?.upload?.kind === 'video'
                ? t('chat.view.titleVideo')
                : t('chat.view.titleFile');
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
              ? {
                  kind: 'file' as const,
                  name: item.name,
                  url: item.upload.url,
                  media: item.upload.kind,
                }
              : { kind: 'file' as const, name: item.name },
        ),
        sessionId: targetSession,
      });
      timing.current = { sentAt: Date.now() };
      const run = await createRun(buildRunInput(text, attachments), targetSession);
      saveActiveRunId(targetSession, run.run_id);
      setActiveRunId(run.run_id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('chat.view.runStartFailed'));
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
    .find(
      (item): item is Extract<TranscriptItem, { kind: 'message' }> =>
        item.kind === 'message' && item.role === 'user',
    );
  const lastAssistantId = [...transcript.items]
    .reverse()
    .find((item) => item.kind === 'message' && item.role === 'assistant')?.id;
  const retry = () => {
    if (lastUser === undefined) return;
    const images: PendingAttachment[] = (lastUser.attachments ?? [])
      .filter((item) => item.kind === 'image' && item.url !== undefined)
      .map((item, index) => ({
        id: `retry-${index}`,
        kind: 'image',
        name: item.name,
        size: 0,
        dataUrl: item.url,
      }));
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
    (item): item is TranscriptApproval =>
      item.kind === 'approval' && item.resolvedChoice === undefined,
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
      {sessionId !== undefined ? (
        <ChatHeader sessionId={sessionId} items={transcript.items} />
      ) : null}
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
              canRetry={
                !running && !sending && item.id === lastAssistantId && lastUser !== undefined
              }
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
          {t('chat.view.latest')}
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
          <p
            className="mb-2 px-1 text-xs text-text-tertiary"
            data-tip={queued.join('\n\n')}
            data-tip-wide
          >
            {t('chat.view.queuedCount', { count: queued.length })}
          </p>
        ) : null}
        {running && pendingApprovals.length > 0 ? (
          <p className="mb-2 px-1 text-xs text-accent">
            {t('chat.view.pendingApprovals', { count: pendingApprovals.length })}
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
