import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dismissToast, useToasts } from '../lib/toast';

/**
 * Toast stack: top-right on desktop, under the top bar on phones, so it never
 * sits on the composer. Each toast slides in and carries its tone as an edge.
 */
export function Toaster() {
  const { t } = useTranslation();
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:top-5 md:right-5 md:items-end md:px-0"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={[
            'yu-pop yu-pop-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl border-l-2 py-2.5 pr-2 pl-3 text-[13px] text-text-primary',
            item.tone === 'error' ? '!border-l-danger' : item.tone === 'success' ? '!border-l-success' : '!border-l-accent',
          ].join(' ')}
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
            aria-label={t('common.dismiss')}
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
