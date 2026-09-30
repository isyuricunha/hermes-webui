import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from '../../lib/clipboard';
import { Check, Copy, CornerDownRight, Download, FileText, Film, ImageIcon, Music, LoaderCircle, Pencil, RotateCcw, Square, Volume2 } from 'lucide-react';
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
      className={['yu-btn yu-btn-ghost size-7 rounded-lg', active ? '!text-agent-soft' : ''].join(' ')}
    >
      {children}
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? 'Copied' : 'Copy message'}
      onClick={() => {
        void copyText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => toast('Copy failed: clipboard unavailable.', 'error'));
      }}
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </ActionButton>
  );
}

// One reply plays at a time across the whole transcript.
let activeAudio: { audio: HTMLAudioElement; stop: () => void } | null = null;

function ReadAloudAction({ text }: { text: string }) {
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
      toastError(error, 'Read aloud failed. Check the TTS settings in Hermes.');
    }
  };

  return (
    <ActionButton label={state === 'idle' ? 'Read aloud' : 'Stop reading'} onClick={() => void play()} active={state !== 'idle'}>
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
              aria-label={`Open ${attachment.name}`}
              onClick={() => setOpen({ url: attachment.url as string, name: attachment.name })}
              className="overflow-hidden rounded-xl border border-border-subtle transition-opacity hover:opacity-90"
            >
              <img src={attachment.url} alt={attachment.name} className="size-24 object-cover sm:size-32" />
            </button>
          );
        }
        if (attachment.kind === 'file' && attachment.url !== undefined && attachment.media === 'audio') {
          return (
            <figure key={index} className="w-72 max-w-full rounded-xl border border-border-subtle bg-surface-input p-2">
              <figcaption className="mb-1 flex items-center gap-1.5 truncate px-1 text-xs text-text-secondary">
                <Music className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{attachment.name}</span>
              </figcaption>
              <audio controls preload="metadata" src={attachment.url} className="h-9 w-full" />
            </figure>
          );
        }
        if (attachment.kind === 'file' && attachment.url !== undefined && attachment.media === 'video') {
          return (
            <video key={index} controls preload="metadata" src={attachment.url} className="max-h-64 w-72 max-w-full rounded-xl border border-border-subtle bg-black" />
          );
        }
        const Icon = attachment.kind === 'image' ? ImageIcon : attachment.media === 'audio' ? Music : attachment.media === 'video' ? Film : FileText;
        const chip = (
          <>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{attachment.name}</span>
            {attachment.url !== undefined ? <Download className="size-3 shrink-0 text-text-tertiary" aria-hidden /> : null}
          </>
        );
        return attachment.url !== undefined && attachment.kind === 'file' ? (
          <a
            key={index}
            href={attachment.url}
            download={attachment.name}
            title={`Download ${attachment.name} (saved where Hermes can read it)`}
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
      {open !== null ? <Lightbox src={open.url} name={open.name} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function UserMessage({ item, onEdit }: { item: TranscriptMessage; onEdit: (text: string) => void }) {
  if (item.content === '' && (item.attachments ?? []).length === 0) {
    return null;
  }
  return (
    <article data-msg="user" className="group mx-auto flex w-full max-w-3xl flex-col items-end px-4 py-2">
      {item.attachments !== undefined && item.attachments.length > 0 ? <Attachments items={item.attachments} /> : null}
      {item.steer === true ? (
        <span
          className="mb-1 inline-flex items-center gap-1 text-[11px] text-agent-soft"
          data-tip="Sent while Hermes was working. Hermes reads it at the next step of the same run (a steer), without stopping it."
        >
          <CornerDownRight className="size-3" aria-hidden />
          Sent while working
        </span>
      ) : null}
      {item.content !== '' ? (
        <div
          data-msg-bubble
          className={[
            'max-w-[85%] rounded-2xl rounded-br-md bg-chip px-4 py-2.5 text-[15px] leading-relaxed text-text-primary shadow-[var(--yu-highlight)]',
            item.steer === true ? 'ring-1 ring-agent/35' : '',
          ].join(' ')}
        >
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      ) : null}
      {item.injected !== undefined ? (
        <details className="group/ctx mt-1 max-w-[85%] text-right">
          <summary className="cursor-pointer list-none text-[11px] text-text-tertiary select-none hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            + context added by a Hermes plugin
          </summary>
          <p className="mt-1 rounded-xl bg-surface-input px-3 py-2 text-left text-xs whitespace-pre-wrap break-words text-text-tertiary">
            {item.injected}
          </p>
        </details>
      ) : null}
      <div className="mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        {item.timestamp !== undefined ? (
          <span className="mr-1 font-mono text-[10.5px] text-text-tertiary">{clockTime(item.timestamp)}</span>
        ) : null}
        <CopyAction text={item.content} />
        <ActionButton label="Edit and resend" onClick={() => onEdit(item.content)}>
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
  if (item.content === '' && item.streaming !== true) {
    return null;
  }
  return (
    <article data-msg="assistant" className="group mx-auto w-full max-w-3xl px-4 py-2">
      <Markdown text={item.content} />
      {item.streaming === true ? (
        <span className="yu-pulse ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-agent text-agent" aria-hidden />
      ) : (
        <div className="mt-1.5 -ml-1.5 flex min-h-7 flex-wrap items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyAction text={item.content} />
          <ReadAloudAction text={item.content} />
          {canRetry ? (
            <ActionButton label="Retry" onClick={onRetry}>
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
  if (stats.output === undefined || stats.streamMs === undefined || stats.streamMs < 400 || stats.output <= 0) return null;
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
  const pieces: ReactNode[] = [];
  if (timestamp !== undefined) {
    pieces.push(<span key="time">{clockTime(timestamp)}</span>);
  }
  if (stats !== undefined) {
    const tps = tokensPerSecond(stats);
    const cache = (stats.cacheRead ?? 0) + (stats.cacheWrite ?? 0);
    if (stats.input !== undefined || stats.output !== undefined) {
      const tokenTip = [
        `Input: ${(stats.input ?? 0).toLocaleString()} tokens (everything the model read for this reply, all steps)`,
        `Output: ${(stats.output ?? 0).toLocaleString()} tokens`,
        stats.model !== undefined ? `Model: ${stats.model}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n');
      pieces.push(
        <span key="tokens" data-tip={tokenTip} data-tip-wide tabIndex={0} className="rounded outline-none focus-visible:text-text-secondary">
          {compactNumber(stats.input ?? 0)} in <span className="text-text-tertiary/60">/</span> {compactNumber(stats.output ?? 0)} out
        </span>,
      );
    }
    if (cache > 0) {
      pieces.push(
        <span
          key="cache"
          data-tip={`Prompt cache: ${(stats.cacheRead ?? 0).toLocaleString()} tokens read from cache (cheaper, faster), ${(stats.cacheWrite ?? 0).toLocaleString()} written.`}
          data-tip-wide
          tabIndex={0}
          className="rounded outline-none focus-visible:text-text-secondary"
        >
          {compactNumber(stats.cacheRead ?? 0)} cached
        </span>,
      );
    }
    if (tps !== null) {
      pieces.push(
        <span
          key="tps"
          data-tip={`About ${tps.toFixed(1)} tokens per second. An estimate: measured in your browser from the first to the last streamed word, so network delay and ping are included${stats.firstTokenMs !== undefined ? `. First text after ${(stats.firstTokenMs / 1000).toFixed(1)}s` : ''}.`}
          data-tip-wide
          tabIndex={0}
          className="rounded outline-none focus-visible:text-text-secondary"
        >
          ~{tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s
        </span>,
      );
    }
  }
  if (pieces.length === 0) return null;
  return (
    <span className="ml-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-l border-border-subtle pl-2.5 font-mono text-[10.5px] text-text-tertiary">
      {pieces.flatMap((piece, index) => (index === 0 ? [piece] : [<Dot key={`dot-${index}`} />, piece]))}
    </span>
  );
}
