import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from '../../lib/clipboard';
import { Check, Copy, FileText, LoaderCircle, Pencil, RotateCcw, Square, Volume2 } from 'lucide-react';
import { speakText } from '../../lib/hx';
import { clockTime } from '../../lib/format';
import { toast, toastError } from '../../lib/toast';
import { Markdown } from './Markdown';
import { speakable } from './speakable';
import type { TranscriptMessage } from './transcript';

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
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {items.map((attachment, index) =>
        attachment.kind === 'image' && attachment.url !== undefined ? (
          <a key={index} href={attachment.url} target="_blank" rel="noreferrer noopener" title={attachment.name}>
            <img
              src={attachment.url}
              alt={attachment.name}
              className="size-24 rounded-xl border border-border-subtle object-cover sm:size-32"
            />
          </a>
        ) : (
          <span key={index} className="yu-chip yu-chip-neutral h-8 rounded-xl px-2.5">
            <FileText className="size-3.5" aria-hidden />
            {attachment.name}
          </span>
        ),
      )}
    </div>
  );
}

export function UserMessage({ item, onEdit }: { item: TranscriptMessage; onEdit: (text: string) => void }) {
  if (item.content === '' && (item.attachments ?? []).length === 0) {
    return null;
  }
  return (
    <article className="group mx-auto flex w-full max-w-3xl flex-col items-end px-4 py-2">
      {item.attachments !== undefined && item.attachments.length > 0 ? <Attachments items={item.attachments} /> : null}
      {item.content !== '' ? (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-chip px-4 py-2.5 text-[15px] leading-relaxed text-text-primary shadow-[var(--yu-highlight)]">
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
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
    <article className="group mx-auto w-full max-w-3xl px-4 py-2">
      <Markdown text={item.content} />
      {item.streaming === true ? (
        <span className="yu-pulse ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-agent text-agent" aria-hidden />
      ) : (
        <div className="mt-1.5 -ml-1.5 flex h-7 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyAction text={item.content} />
          <ReadAloudAction text={item.content} />
          {canRetry ? (
            <ActionButton label="Retry" onClick={onRetry}>
              <RotateCcw className="size-3.5" aria-hidden />
            </ActionButton>
          ) : null}
          {item.timestamp !== undefined ? (
            <span className="ml-1 font-mono text-[10.5px] text-text-tertiary">{clockTime(item.timestamp)}</span>
          ) : null}
        </div>
      )}
    </article>
  );
}
