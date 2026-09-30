import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, ImageOff, X } from 'lucide-react';
import { isDeliverableMediaPath, mediaFileName, mediaKindOf } from '@hermes-webui/shared';

/** Same-origin URL for a Hermes-host file (allowlisted proxy to the dashboard). */
function mediaUrl(path: string): string {
  return `/api/hx/fs/download?path=${encodeURIComponent(path)}`;
}

function Unavailable({ path, reason }: { path: string; reason: string }) {
  return (
    <span
      className="my-2 flex max-w-md items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-input px-3 py-2.5 text-xs text-text-tertiary"
      title={path}
    >
      <ImageOff className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium text-text-secondary">{mediaFileName(path)}</span>
        <span className="block">{reason}</span>
      </span>
    </span>
  );
}

function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4 text-sm text-white/80" onClick={(event) => event.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <a href={src} download={name} className="yu-btn yu-btn-ghost h-9 gap-1.5 px-3 text-white/80 hover:text-white">
          <Download className="size-4" aria-hidden />
          Download
        </a>
        <button type="button" onClick={onClose} aria-label="Close" className="yu-btn yu-btn-ghost size-9 p-0 text-white/80 hover:text-white">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        <img src={src} alt={name} className="max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
      </div>
    </div>,
    document.body,
  );
}

/**
 * A file the assistant delivered with `MEDIA:/path`: images inline (click to
 * enlarge), audio and video with players, anything else as a download card.
 */
export function MediaEmbed({ path }: { path: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const name = mediaFileName(path);
  const kind = mediaKindOf(path);

  if (!isDeliverableMediaPath(path) || kind === null) {
    return <Unavailable path={path} reason="This file type is not shown in the WebUI." />;
  }
  if (failed) {
    return <Unavailable path={path} reason="Could not load this file (moved, deleted or not readable)." />;
  }
  const src = mediaUrl(path);

  if (kind === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={path}
          className="my-2 block max-w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-input transition-opacity hover:opacity-90"
        >
          <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="block max-h-[420px] w-auto max-w-full object-contain" />
        </button>
        {open ? <Lightbox src={src} name={name} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }
  if (kind === 'audio') {
    return (
      <span className="my-2 block max-w-md rounded-xl border border-border-subtle bg-surface-input p-2.5" title={path}>
        <span className="mb-1.5 block truncate px-1 text-xs text-text-tertiary">{name}</span>
        <audio controls preload="metadata" src={src} onError={() => setFailed(true)} className="w-full" />
      </span>
    );
  }
  if (kind === 'video') {
    return (
      <video
        controls
        preload="metadata"
        src={src}
        title={path}
        onError={() => setFailed(true)}
        className="my-2 block max-h-[420px] max-w-full rounded-xl border border-border-subtle bg-black"
      />
    );
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : 'FILE';
  return (
    <span className="my-2 flex max-w-md items-center gap-3 rounded-xl border border-border-subtle bg-surface-input px-3 py-2.5" title={path}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-chip text-text-secondary">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">{name}</span>
        <span className="block font-mono text-[11px] text-text-tertiary">{ext}</span>
      </span>
      <a href={src} download={name} className="yu-btn yu-btn-tonal h-8 gap-1.5 px-3 text-xs no-underline">
        <Download className="size-3.5" aria-hidden />
        Download
      </a>
    </span>
  );
}
