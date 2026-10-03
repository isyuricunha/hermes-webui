import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import type { ErrorComponentProps } from '@tanstack/react-router';

/** Router error boundary: explains, offers a retry and a way home. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <div className="yu-card yu-rise max-w-md rounded-3xl p-6 text-center">
        <span className="yu-chip-danger mx-auto flex size-10 items-center justify-center rounded-2xl">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-medium text-text-primary">{t('shell.snagTitle')}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{t('shell.snagDesc')}</p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-surface-editor p-3 text-left font-mono text-[11px] whitespace-pre-wrap text-text-tertiary">
          {message}
        </pre>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="yu-btn yu-btn-secondary h-9 px-4 text-[13px]" onClick={reset}>
            {t('shell.tryAgain')}
          </button>
          <a href="/" className="yu-btn yu-btn-primary h-9 px-4 text-[13px]">
            {t('shell.backToChat')}
          </a>
        </div>
      </div>
    </div>
  );
}
