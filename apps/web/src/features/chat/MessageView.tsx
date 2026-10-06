import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { copyText } from '../../lib/clipboard';
import {
  Check,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Film,
  ImageIcon,
  Music,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react';
import { Lightbox } from './MediaEmbed';
import { speakText } from '../../lib/hx';
import { clockTime, compactNumber } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Markdown } from './Markdown';
import { speakable } from './speakable';
import type { ReplyStats, TranscriptMessage } from './transcript';

function ActionButton({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={['yu-btn yu-btn-ghost size-7 rounded-lg', active ? '!text-agent-soft' : ''].join(
        ' ',
      )}
    >
      {children}
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? t('common.copied') : t('chat.message.copyMessage')}
      onClick={() => {
        void copyText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => toast(t('chat.message.copyFailed'), 'error'));
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </ActionButton>
  );
}

// One reply plays at a time across the whole transcript.
let activeAudio: { audio: HTMLAudioElement; stop: () => void } | null = null;

function ReadAloudAction({ text }: { text: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState('idle');
  };

  const play = async () => {
    if (state !== 'idle') {
      stop();
      return;
    }
    activeAudio?.stop();
    setState('loading');
    try {
      const result = await speakText(speakable(text));
      const audio = new Audio(result.data_url);
      audioRef.current = audio;
      activeAudio = { audio, stop };
      audio.onended = () => setState('idle');
      audio.onerror = () => setState('idle');
      await audio.play();
      setState('playing');
    } catch (error) {
      setState('idle');
      toastError(error, t('chat.message.readAloudFailed'));
    }
  };

  return (
    <ActionButton
      label={state === 'idle' ? t('chat.message.readAloud') : t('chat.message.stopReading')}
      onClick={() => void play()}
      active={state !== 'idle'}
    >
      {state === 'loading' ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : state === 'playing' ? (
        <Square className="size-3 fill-current" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
    </ActionButton>
  );
}

function Attachments({ items }: { items: NonNullable<TranscriptMessage['attachments']> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ url: string; name: string } | null>(null);
  return (
    <div className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {items.map((attachment, index) => {
        if (attachment.kind === 'image' && attachment.url !== undefined) {
          return (
            <button
              key={index}
              type="button"
              title={attachment.name}
              aria-label={t('chat.message.openAttachment', { name: attachment.name })}
              onClick={() => setOpen({ url: attachment.url as string, name: attachment.name })}
              className="overflow-hidden rounded-xl border border-border-subtle transition-opacity hover:opacity-90"
            >
              <img
                src={attachment.url}
                alt={attachment.name}
                className="size-24 object-cover sm:size-32"
              />
            </button>
          );
        }
        if (
          attachment.kind === 'file' &&
          attachment.url !== undefined &&
          attachment.media === 'audio'
        ) {
          return (
            <figure
              key={index}
              className="w-72 max-w-full rounded-xl border border-border-subtle bg-surface-input p-2"
            >
              <figcaption className="mb-1 flex items-center gap-1.5 truncate px-1 text-xs text-text-secondary">
                <Music className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{attachment.name}</span>
              </figcaption>
              <audio controls preload="metadata" src={attachment.url} className="h-9 w-full" />
            </figure>
          );
        }
        if (
          attachment.kind === 'file' &&
          attachment.url !== undefined &&
          attachment.media === 'video'
        ) {
          return (
            <video
              key={index}
              controls
              preload="metadata"
              src={attachment.url}
              className="max-h-64 w-72 max-w-full rounded-xl border border-border-subtle bg-black"
            />
          );
        }
        const Icon =
          attachment.kind === 'image'
            ? ImageIcon
            : attachment.media === 'audio'
              ? Music
              : attachment.media === 'video'
                ? Film
                : FileText;
        const chip = (
          <>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{attachment.name}</span>
            {attachment.url !== undefined ? (
              <Download className="size-3 shrink-0 text-text-tertiary" aria-hidden />
            ) : null}
          </>
        );
        return attachment.url !== undefined && attachment.kind === 'file' ? (
          <a
            key={index}
            href={attachment.url}
            download={attachment.name}
            title={t('chat.message.downloadAttachment', { name: attachment.name })}
            className="yu-chip yu-chip-neutral h-8 max-w-64 rounded-xl px-2.5 hover:text-text-primary"
          >
            {chip}
          </a>
        ) : (
          <span key={index} className="yu-chip yu-chip-neutral h-8 max-w-64 rounded-xl px-2.5">
            {chip}
          </span>
        );
      })}
      {open !== null ? (
        <Lightbox src={open.url} name={open.name} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function nativeSender(content: string): 'goal' | 'kanban' | 'cron' | 'delegation' | 'process' | 'agent' | null {
  const text = content.trimStart();
  if (text.startsWith('[Continuing toward your standing goal]')) return 'goal';
  if (text.startsWith('[Continuing toward this kanban task')) return 'kanban';
  if (text.startsWith('[Cron delivery:') || text.startsWith('[Cronjob ')) return 'cron';
  if (text.startsWith('[ASYNC DELEGATION')) return 'delegation';
  if (text.startsWith('[Background process') || text.startsWith('[IMPORTANT: Background process')) return 'process';
  if (text.startsWith('[Message from agent') || text.startsWith('Message from ')) return 'agent';
  return null;
}

export function UserMessage({
  item,
  onEdit,
}: {
  item: TranscriptMessage;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (item.content === '' && (item.attachments ?? []).length === 0) {
    return null;
  }
  const injected = nativeSender(item.content);
  if (injected !== null) {
    return (
      <article data-msg="goal" className="mx-auto w-full max-w-3xl px-4 py-2">
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-agent-soft uppercase">
          {t(`chat.injected.${injected}`)}
        </p>
        <div className="rounded-2xl rounded-bl-md border border-agent/30 bg-agent-soft/10 px-4 py-2.5 text-text-secondary" style={{ fontSize: 'var(--chat-font-size, 15px)', lineHeight: 'var(--chat-leading, 1.55)' }}>
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      </article>
    );
  }
  return (
    <article
      data-msg="user"
      className="group mx-auto flex w-full max-w-3xl flex-col items-end px-4 py-2"
    >
      {item.attachments !== undefined && item.attachments.length > 0 ? (
        <Attachments items={item.attachments} />
      ) : null}
      {item.steer === true ? (
        <span
          className="mb-1 inline-flex items-center gap-1 text-[11px] text-agent-soft"
          data-tip={t('chat.sentWhileWorkingTip')}
        >
          <CornerDownRight className="size-3" aria-hidden />
          {t('chat.sentWhileWorking')}
        </span>
      ) : null}
      {item.content !== '' ? (
        <div
          data-msg-bubble
          className={[
            'max-w-[85%] rounded-2xl rounded-br-md bg-chip px-4 py-2.5 text-text-primary shadow-[var(--yu-highlight)]',
            item.steer === true ? 'ring-1 ring-agent/35' : '',
          ].join(' ')}
          style={{ fontSize: 'var(--chat-font-size, 15px)', lineHeight: 'var(--chat-leading, 1.55)' }}
        >
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      ) : null}
      {item.injected !== undefined ? (
        <details className="group/ctx mt-1 max-w-[85%] text-right">
          <summary className="cursor-pointer list-none text-[11px] text-text-tertiary select-none hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            + {t('chat.message.contextAdded')}
          </summary>
          <p className="mt-1 rounded-xl bg-surface-input px-3 py-2 text-left text-xs whitespace-pre-wrap break-words text-text-tertiary">
            {item.injected}
          </p>
        </details>
      ) : null}
      <div className="mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        {item.timestamp !== undefined ? (
          <span className="mr-1 font-mono text-[10.5px] text-text-tertiary">
            {clockTime(item.timestamp)}
          </span>
        ) : null}
        <CopyAction text={item.content} />
        <ActionButton label={t('chat.message.editAndResend')} onClick={() => onEdit(item.content)}>
          <Pencil className="size-3.5" aria-hidden />
        </ActionButton>
      </div>
    </article>
  );
}

export function AssistantMessage({
  item,
  canRetry,
  onRetry,
}: {
  item: TranscriptMessage;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (item.content === '' && item.streaming !== true) {
    return null;
  }
  return (
    <article data-msg="assistant" className="group mx-auto w-full max-w-3xl px-4 py-2">
      <Markdown text={item.content} />
      {item.streaming === true ? (
        <span
          className="yu-pulse ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-agent text-agent"
          aria-hidden
        />
      ) : (
        <div className="mt-1.5 -ml-1.5 flex min-h-7 flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyAction text={item.content} />
          <ReadAloudAction text={item.content} />
          {canRetry ? (
            <ActionButton label={t('common.retry')} onClick={onRetry}>
              <RotateCcw className="size-3.5" aria-hidden />
            </ActionButton>
          ) : null}
          <MetaLine timestamp={item.timestamp} stats={item.stats} />
        </div>
      )}
    </article>
  );
}

/** Tokens per second while text streamed; only when the stream was long enough to mean something. */
export function tokensPerSecond(stats: ReplyStats): number | null {
  if (
    stats.output === undefined ||
    stats.streamMs === undefined ||
    stats.streamMs < 400 ||
    stats.output <= 0
  )
    return null;
  return stats.output / (stats.streamMs / 1000);
}

function Dot() {
  return (
    <span aria-hidden className="text-text-tertiary/70 select-none">
      ·
    </span>
  );
}

/**
 * Time and the reply's numbers after the actions: a hairline divider, then
 * each group separated by a dot so "12.4K in / 180 out · 9.8K cached ·
 * ~189 tok/s" reads as distinct facts. Every group explains itself on hover.
 */
function MetaLine({ timestamp, stats }: { timestamp?: number; stats?: ReplyStats }) {
  const { t } = useTranslation();
  const pieces: ReactNode[] = [];
  if (timestamp !== undefined) {
    pieces.push(<span key="time">{clockTime(timestamp)}</span>);
  }
  if (stats !== undefined) {
    const tps = tokensPerSecond(stats);
    const cache = (stats.cacheRead ?? 0) + (stats.cacheWrite ?? 0);
    if (stats.input !== undefined || stats.output !== undefined) {
      const tokenTip = [
        t('chat.message.inputTip', { count: (stats.input ?? 0).toLocaleString() }),
        t('chat.message.outputTip', { count: (stats.output ?? 0).toLocaleString() }),
        stats.model !== undefined ? t('chat.message.modelTip', { model: stats.model }) : '',
      ]
        .filter((line) => line !== '')
        .join('\n');
      pieces.push(
        <span
          key="tokens"
          data-tip={tokenTip}
          data-tip-wide
          tabIndex={0}
          className="rounded outline-none focus-visible:text-text-secondary"
        >
          {t('chat.message.inputLabel', { count: compactNumber(stats.input ?? 0) })}{' '}
          <span className="text-text-tertiary/60">/</span>{' '}
          {t('chat.message.outputLabel', { count: compactNumber(stats.output ?? 0) })}
        </span>,
      );
    }
    if (cache > 0) {
      pieces.push(
        <span
          key="cache"
          data-tip={t('chat.message.cacheTip', {
            read: (stats.cacheRead ?? 0).toLocaleString(),
            written: (stats.cacheWrite ?? 0).toLocaleString(),
          })}
          data-tip-wide
          tabIndex={0}
          className="rounded outline-none focus-visible:text-text-secondary"
        >
          {t('chat.message.cached', { count: compactNumber(stats.cacheRead ?? 0) })}
        </span>,
      );
    }
    if (tps !== null) {
      pieces.push(
        <span
          key="tps"
          data-tip={t('chat.message.tpsTip', {
            tps: tps.toFixed(1),
            firstToken:
              stats.firstTokenMs !== undefined
                ? `. First text after ${(stats.firstTokenMs / 1000).toFixed(1)}s`
                : '',
          })}
          data-tip-wide
          tabIndex={0}
          className="rounded outline-none focus-visible:text-text-secondary"
        >
          {t('chat.message.tokensPerSecond', { tps: tps < 10 ? tps.toFixed(1) : Math.round(tps) })}
        </span>,
      );
    }
  }
  if (pieces.length === 0) return null;
  return (
    <span className="ml-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-l border-border-subtle pl-2.5 font-mono text-[10.5px] text-text-tertiary">
      {pieces.flatMap((piece, index) =>
        index === 0 ? [piece] : [<Dot key={`dot-${index}`} />, piece],
      )}
    </span>
  );
}
