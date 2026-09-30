import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { dismissToast, useToasts } from '../lib/toast';

/** Bottom-center toast stack (above the composer on mobile). */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="yu-pop yu-rise pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3 text-[13px] text-text-primary"
          style={{ ['--yu-delay' as string]: '0ms', animationDuration: '0.35s' }}
        >
          <span
            aria-hidden
            className={[
              'flex size-5 shrink-0 items-center justify-center rounded-full',
              item.tone === 'error' ? 'yu-chip-danger' : item.tone === 'success' ? 'yu-chip-success' : 'bg-chip text-text-secondary',
            ].join(' ')}
          >
            {item.tone === 'error' ? (
              <TriangleAlert className="size-3" />
            ) : item.tone === 'success' ? (
              <Check className="size-3" />
            ) : (
              <Info className="size-3" />
            )}
          </span>
          <span className="min-w-0 flex-1 break-words">{item.message}</span>
          {item.action !== undefined ? (
            <button
              type="button"
              className="yu-btn yu-btn-tonal h-7 rounded-lg px-2.5 text-xs"
              onClick={() => {
                item.action?.onClick();
                dismissToast(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            className="yu-btn yu-btn-ghost size-7 rounded-lg"
            onClick={() => dismissToast(item.id)}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
