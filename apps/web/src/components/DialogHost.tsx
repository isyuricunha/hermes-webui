import { useEffect, useRef, useState } from 'react';
import { useDialogRequest, type DialogRequest } from '../lib/dialog';

function DialogBody({ request }: { request: DialogRequest }) {
  const [value, setValue] = useState(request.initialValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        request.resolve(request.kind === 'confirm' ? false : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  const submit = () => {
    if (request.kind === 'prompt') {
      const trimmed = value.trim();
      if (trimmed === '') return;
      request.resolve(trimmed);
    } else {
      request.resolve(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-hidden
        onClick={() => request.resolve(request.kind === 'confirm' ? false : null)}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`dialog-title-${request.id}`}
        className="yu-pop yu-rise relative w-full max-w-sm rounded-3xl p-5"
        style={{ animationDuration: '0.35s' }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id={`dialog-title-${request.id}`} className="text-base font-medium text-text-primary">
          {request.title}
        </h2>
        {request.description !== undefined ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{request.description}</p>
        ) : null}
        {request.kind === 'prompt' ? (
          <input
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            aria-label={request.title}
            className="yu-input mt-4 h-10 w-full px-3 text-sm"
          />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="yu-btn yu-btn-ghost h-9 px-3.5 text-[13px]"
            onClick={() => request.resolve(request.kind === 'confirm' ? false : null)}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            className={[
              'yu-btn h-9 px-4 text-[13px]',
              request.tone === 'danger' ? 'yu-btn-danger' : 'yu-btn-primary',
            ].join(' ')}
          >
            {request.confirmLabel ?? (request.kind === 'prompt' ? 'Save' : 'Confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Renders the pending confirm/prompt dialog, if any. */
export function DialogHost() {
  const request = useDialogRequest();
  return request === null ? null : <DialogBody key={request.id} request={request} />;
}
