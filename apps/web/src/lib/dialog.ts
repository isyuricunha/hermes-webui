import { useSyncExternalStore } from 'react';

/**
 * Promise-based confirm/prompt dialogs, replacing window.confirm/prompt.
 * `confirmDialog()` resolves true/false; `promptDialog()` resolves the text
 * or null. <DialogHost /> renders whichever request is pending.
 */

export interface DialogRequest {
  id: number;
  kind: 'confirm' | 'prompt';
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  initialValue?: string;
  placeholder?: string;
  resolve: (value: string | boolean | null) => void;
}

let current: DialogRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function open(request: Omit<DialogRequest, 'id' | 'resolve'>): Promise<string | boolean | null> {
  // A newer dialog replaces an older one; the older resolves as cancelled.
  current?.resolve(request.kind === 'confirm' ? false : null);
  return new Promise((resolve) => {
    current = {
      ...request,
      id: nextId++,
      resolve: (value) => {
        current = null;
        emit();
        resolve(value);
      },
    };
    emit();
  });
}

export function confirmDialog(options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
}): Promise<boolean> {
  return open({ kind: 'confirm', ...options }).then((value) => value === true);
}

export function promptDialog(options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  initialValue?: string;
  placeholder?: string;
}): Promise<string | null> {
  return open({ kind: 'prompt', ...options }).then((value) => (typeof value === 'string' ? value : null));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDialogRequest(): DialogRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
