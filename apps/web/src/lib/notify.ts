/**
 * Background completion signal: when a run finishes while the tab is hidden,
 * show a system notification (if allowed) and badge the tab title until the
 * user comes back.
 */

const BASE_TITLE = 'Hermes';
let unseen = 0;

function setTitle(): void {
  document.title = unseen > 0 ? `(${unseen}) ${BASE_TITLE}` : BASE_TITLE;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      unseen = 0;
      setTitle();
    }
  });
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
}

/** Ask once, from a user gesture (Settings > Appearance or the first send). */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function notifyRunFinished(eventType: string, output: string): void {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return;
  unseen += 1;
  setTitle();
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const failed = eventType !== 'run.completed';
  const body = failed
    ? 'The task did not finish. Open Hermes to see what happened.'
    : output.replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Reply ready.';
  const title = failed ? 'Hermes: task stopped' : 'Hermes replied';
  const options = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'hermes-run' };
  // Mobile browsers only show notifications through the service worker.
  void navigator.serviceWorker?.getRegistration()
    .then((registration) => {
      if (registration !== undefined) return registration.showNotification(title, options);
      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return undefined;
    })
    .catch(() => undefined);
}
