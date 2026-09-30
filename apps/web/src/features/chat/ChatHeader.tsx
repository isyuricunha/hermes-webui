import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import {
  Archive,
  Braces,
  Clock,
  Download,
  GitFork,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Send,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { deleteSession, fetchSessionDetail, forkSession, patchSession } from '../../lib/api';
import { sessionExportUrl } from '../../lib/hx';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { compactNumber, money, relativeTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Menu } from '../../components/ui';
import type { TranscriptItem } from './transcript';
import { useHeaderSlot } from '../../app/headerSlot';
import { displayTitle, transcriptToMarkdown } from './chatExport';

const SOURCE: Record<string, { label: string; icon: typeof Send }> = {
  telegram: { label: 'Telegram', icon: Send },
  cron: { label: 'Cron', icon: Clock },
  cli: { label: 'CLI', icon: SquareTerminal },
  tui: { label: 'Terminal', icon: SquareTerminal },
};

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'conversation';
}

/**
 * Conversation header: title (click to rename), where it came from, usage,
 * and the conversation actions. On phones it renders into the app bar.
 */
export function ChatHeader({ sessionId, items }: { sessionId: string; items: TranscriptItem[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mobileSlot = useHeaderSlot();
  const detail = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => fetchSessionDetail(sessionId),
    staleTime: 15_000,
  });
  const session = detail.data?.session;
  const title = displayTitle(session, sessionId);
  const source = SOURCE[(session?.source ?? '').toLowerCase()] ?? { label: 'WebUI', icon: MessageSquare };
  const SourceIcon = source.icon;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const patch = useMutation({
    mutationFn: (body: { title?: string; pinned?: boolean; archived?: boolean }) => patchSession(sessionId, body),
    onSuccess: refresh,
    onError: (error) => toastError(error),
  });

  const rename = async () => {
    const next = await promptDialog({ title: 'Rename conversation', initialValue: title, confirmLabel: 'Rename' });
    if (next !== null && next !== title) patch.mutate({ title: next });
  };

  const archive = () => {
    patch.mutate(
      { archived: true },
      {
        onSuccess: () => {
          toast('Conversation archived.', 'success', {
            action: { label: 'Undo', onClick: () => patch.mutate({ archived: false }) },
          });
          void navigate({ to: '/' });
        },
      },
    );
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete this conversation?',
      description: `"${title}" and its messages are removed from Hermes. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSession(sessionId);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast('Conversation deleted.', 'success');
      void navigate({ to: '/' });
    } catch (error) {
      toastError(error);
    }
  };

  const fork = async () => {
    try {
      const created = await forkSession(sessionId);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast('Forked into a new conversation.', 'success');
      void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
    } catch (error) {
      toastError(error);
    }
  };

  const tokens = (session?.input_tokens ?? 0) + (session?.output_tokens ?? 0);
  const pinned = session?.pinned === true;

  const menu = (
    <Menu
      label="Conversation actions"
      trigger={<MoreHorizontal className="size-4" aria-hidden />}
      items={[
        { label: 'Rename', icon: <Pencil />, onSelect: () => void rename() },
        pinned
          ? { label: 'Unpin', icon: <PinOff />, onSelect: () => patch.mutate({ pinned: false }) }
          : { label: 'Pin', icon: <Pin />, onSelect: () => patch.mutate({ pinned: true }) },
        { label: 'Fork', icon: <GitFork />, onSelect: () => void fork() },
        {
          label: 'Export as Markdown',
          icon: <Download />,
          onSelect: () => download(`${slug(title)}.md`, transcriptToMarkdown(title, items), 'text/markdown'),
        },
        {
          label: 'Export as JSON',
          icon: <Braces />,
          onSelect: () => {
            const link = document.createElement('a');
            link.href = sessionExportUrl(sessionId);
            link.download = `${slug(title)}.json`;
            link.click();
          },
        },
        { label: 'Archive', icon: <Archive />, onSelect: archive },
        { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void remove() },
      ]}
    />
  );


  return (
    <>
      <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-5 md:flex">
        <button
          type="button"
          onClick={() => void rename()}
          className="min-w-0 truncate rounded-lg px-1.5 py-1 text-left text-[15px] font-medium text-text-primary transition-colors hover:bg-surface-input"
          title="Rename"
        >
          {title}
        </button>
        {pinned ? <Pin className="size-3.5 shrink-0 text-accent" aria-label="Pinned" /> : null}
        <span className="yu-chip yu-chip-neutral shrink-0">
          <SourceIcon className="size-3" aria-hidden />
          {source.label}
        </span>
        <span className="flex-1" />
        {session !== undefined ? (
          <span className="hidden shrink-0 items-center gap-3 font-mono text-[11px] text-text-tertiary lg:flex">
            {session.message_count > 0 ? <span title="Messages">{session.message_count} msgs</span> : null}
            {tokens > 0 ? <span title="Input + output tokens">{compactNumber(tokens)} tokens</span> : null}
            {typeof session.estimated_cost_usd === 'number' && session.estimated_cost_usd > 0 ? (
              <span title="Estimated cost">{money(session.estimated_cost_usd)}</span>
            ) : null}
            {session.last_active ? <span title="Last activity">{relativeTime(session.last_active)}</span> : null}
          </span>
        ) : null}
        {menu}
      </header>
      {mobileSlot !== null
        ? createPortal(
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => void rename()}
                className="min-w-0 flex-1 truncate text-left text-[15px] font-medium tracking-[-0.01em]"
              >
                {title}
              </button>
              {menu}
            </div>,
            mobileSlot,
          )
        : null}
    </>
  );
}
