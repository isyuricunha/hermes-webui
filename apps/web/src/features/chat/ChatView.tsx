import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { NormalizedCommand } from '@hermes-webui/shared';
import { commandArgs, findCommandIn } from '@hermes-webui/shared';
import {
  createRun,
  createSession,
  fetchAppStatus,
  fetchCommands,
  fetchRun,
  fetchSessionImages,
  fetchSessionMessages,
  fetchSessionModel,
  stopRun,
  steerRun,
} from '../../lib/api';
import { rememberDerivedTitle } from '../../lib/sessionTitles';
import {
  applyEvent,
  emptyTranscript,
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

// --- Subcomponents -----------------------------------------------------------

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
      title: string;
      detail?: string;
      tone: 'info' | 'success' | 'warning';
      widget?: 'memory-approvals';
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
            id: `sys-${Date.now()}-${state.items.length}`,
            title: action.title,
            detail: action.detail,
            tone: action.tone,
            ...(action.widget !== undefined ? { widget: action.widget } : {}),
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
    const items = historyToItems(messagesQuery.data.data, storedImages ?? []);
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
          const total = commandsQuery.data?.commands.length ?? 0;
          notice(
            'Hermes commands',
            `Native here: /new /model /status /sessions /settings /skills /memory /stop /help.\nType "/" to browse all ${total} registry commands (CLI/TUI-only ones are labeled).`,
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
    [activeRunId, transcript.runDone, commandsQuery.data, currentModel, currentProvider, queryClient],
  );

  const send = async (text: string, attachments: PendingAttachment[] = []) => {
    if (sending) return;
    // Command interception: recognized -> native execution; unrecognized
    // slash input -> explanatory card. Neither becomes a user message.
    if (attachments.length === 0) {
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
    }
    setError(null);
    setSending(true);
    try {
      const titleSeed = text !== '' ? text : (attachments[0]?.name ?? 'Attachment');
      if (sessionId === undefined) {
        // A conversation exists only once something is sent: create it now and
        // hand the message to that conversation's own view.
        const created = await createSession({ title: titleSeed.slice(0, 60) });
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
        text,
        attachments: attachments.map((item) =>
          item.kind === 'image'
            ? { kind: 'image' as const, name: item.name, url: item.dataUrl }
            : { kind: 'file' as const, name: item.name },
        ),
        sessionId: targetSession,
      });
      const run = await createRun(buildRunInput(text, attachments), targetSession);
      saveActiveRunId(targetSession, run.run_id);
      setActiveRunId(run.run_id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to start the run.');
    } finally {
      setSending(false);
    }
  };

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
