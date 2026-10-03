import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { CHAT_ACTION_EVENT, type ChatAction } from '../../lib/events';
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
  telegram: { label: 'chat.header.sourceTelegram', icon: Send },
  cron: { label: 'chat.header.sourceCron', icon: Clock },
  cli: { label: 'chat.header.sourceCli', icon: SquareTerminal },
  tui: { label: 'chat.header.sourceTerminal', icon: SquareTerminal },
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
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'conversation'
  );
}

/**
 * Conversation header: title (click to rename), where it came from, usage,
 * and the conversation actions. On phones it renders into the app bar.
 */
export function ChatHeader({ sessionId, items }: { sessionId: string; items: TranscriptItem[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobileSlot = useHeaderSlot();
  const detail = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => fetchSessionDetail(sessionId),
    staleTime: 15_000,
  });
  const session = detail.data?.session;
  const title = displayTitle(session, sessionId) ?? t('sessions.newChat');
  const source = SOURCE[(session?.source ?? '').toLowerCase()] ?? {
    label: 'chat.header.sourceWebui',
    icon: MessageSquare,
  };
  const SourceIcon = source.icon;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const patch = useMutation({
    mutationFn: (body: { title?: string; pinned?: boolean; archived?: boolean }) =>
      patchSession(sessionId, body),
    onSuccess: refresh,
    onError: (error) => toastError(error),
  });

  const rename = async () => {
    const next = await promptDialog({
      title: t('chat.header.renameConversation'),
      initialValue: title,
      confirmLabel: t('chat.header.rename'),
    });
    if (next !== null && next !== title) patch.mutate({ title: next });
  };

  const archive = () => {
    patch.mutate(
      { archived: true },
      {
        onSuccess: () => {
          toast(t('chat.header.archived'), 'success', {
            action: {
              label: t('chat.header.undo'),
              onClick: () => patch.mutate({ archived: false }),
            },
          });
          void navigate({ to: '/' });
        },
      },
    );
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: t('chat.header.deleteTitle'),
      description: t('chat.header.deleteDescription', { title }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSession(sessionId);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast(t('chat.header.deleted'), 'success');
      void navigate({ to: '/' });
    } catch (error) {
      toastError(error);
    }
  };

  const fork = async () => {
    try {
      const created = await forkSession(sessionId);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast(t('chat.header.forked'), 'success');
      void navigate({ to: '/chat/$sessionId', params: { sessionId: created.session.id } });
    } catch (error) {
      toastError(error);
    }
  };

  // /title, /fork and /export in the composer land here.
  useEffect(() => {
    const handler = (event: Event) => {
      const { action, arg = '' } = (event as CustomEvent<{ action: ChatAction; arg?: string }>)
        .detail;
      if (action === 'rename') {
        if (arg.trim() !== '') patch.mutate({ title: arg.trim().slice(0, 120) });
        else void rename();
      } else if (action === 'fork') {
        void fork();
      } else if (action === 'export') {
        if (arg.trim().toLowerCase() === 'json') {
          const link = document.createElement('a');
          link.href = sessionExportUrl(sessionId);
          link.download = `${slug(title)}.json`;
          link.click();
        } else {
          download(`${slug(title)}.md`, transcriptToMarkdown(title, items), 'text/markdown');
        }
      }
    };
    window.addEventListener(CHAT_ACTION_EVENT, handler);
    return () => window.removeEventListener(CHAT_ACTION_EVENT, handler);
  });

  const tokens = (session?.input_tokens ?? 0) + (session?.output_tokens ?? 0);
  const pinned = session?.pinned === true;

  const menu = (
    <Menu
      label={t('chat.header.actions')}
      trigger={<MoreHorizontal className="size-4" aria-hidden />}
      items={[
        { label: t('chat.header.rename'), icon: <Pencil />, onSelect: () => void rename() },
        pinned
          ? {
              label: t('chat.header.unpin'),
              icon: <PinOff />,
              onSelect: () => patch.mutate({ pinned: false }),
            }
          : {
              label: t('chat.header.pin'),
              icon: <Pin />,
              onSelect: () => patch.mutate({ pinned: true }),
            },
        { label: t('chat.header.fork'), icon: <GitFork />, onSelect: () => void fork() },
        {
          label: t('chat.header.exportMarkdown'),
          icon: <Download />,
          onSelect: () =>
            download(`${slug(title)}.md`, transcriptToMarkdown(title, items), 'text/markdown'),
        },
        {
          label: t('chat.header.exportJson'),
          icon: <Braces />,
          onSelect: () => {
            const link = document.createElement('a');
            link.href = sessionExportUrl(sessionId);
            link.download = `${slug(title)}.json`;
            link.click();
          },
        },
        { label: t('chat.header.archive'), icon: <Archive />, onSelect: archive },
        {
          label: t('common.delete'),
          icon: <Trash2 />,
          danger: true,
          onSelect: () => void remove(),
        },
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
          title={t('chat.header.rename')}
        >
          {title}
        </button>
        {pinned ? (
          <Pin className="size-3.5 shrink-0 text-accent" aria-label={t('chat.header.pinned')} />
        ) : null}
        <span className="yu-chip yu-chip-neutral shrink-0">
          <SourceIcon className="size-3" aria-hidden />
          {t(source.label)}
        </span>
        <span className="flex-1" />
        {session !== undefined ? (
          <span className="hidden shrink-0 items-center gap-3 font-mono text-[11px] text-text-tertiary lg:flex">
            {session.message_count > 0 ? (
              <span title={t('chat.header.messagesTitle')}>
                {t('chat.header.messageCount', { count: session.message_count })}
              </span>
            ) : null}
            {tokens > 0 ? (
              <span title={t('chat.header.tokensTitle')}>
                {t('chat.header.tokens', { count: compactNumber(tokens) })}
              </span>
            ) : null}
            {typeof session.estimated_cost_usd === 'number' && session.estimated_cost_usd > 0 ? (
              <span title={t('chat.header.costTitle')}>{money(session.estimated_cost_usd)}</span>
            ) : null}
            {session.last_active ? (
              <span title={t('chat.header.activityTitle')}>
                {relativeTime(session.last_active)}
              </span>
            ) : null}
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
