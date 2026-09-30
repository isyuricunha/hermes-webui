import { useSyncExternalStore } from 'react';

/**
 * Tiny toast store: any module can call `toast()`; <Toaster /> renders the
 * queue. Toasts auto-dismiss; errors stay a little longer.
 */

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function toast(
  message: string,
  tone: ToastTone = 'info',
  options: { action?: Toast['action']; durationMs?: number } = {},
): number {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, tone, action: options.action }];
  emit();
  const duration = options.durationMs ?? (tone === 'error' ? 6000 : 3200);
  setTimeout(() => dismissToast(id), duration);
  return id;
}

/** Convenience for mutation error handlers. */
export function toastError(error: unknown, fallback = 'Something went wrong.'): void {
  toast(error instanceof Error && error.message !== '' ? error.message : fallback, 'error');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
}
