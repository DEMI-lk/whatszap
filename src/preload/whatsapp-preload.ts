import { ipcRenderer } from 'electron';

/**
 * Runs inside WhatsApp Web's view (sandboxed, no Node). Replaces the page's
 * Notification API with a capture shim: WhatsApp's own notification data is
 * forwarded to the main process, which shows a single unified WhatsZAP toast.
 * The real notification pipeline is never touched, so the page's own native
 * toast can not appear (the session also denies the notifications permission
 * as a second lock against ServiceWorker showNotification paths).
 */

interface PageNotificationOptions {
  body?: string;
}

class NotificationShim {
  static readonly permission = 'granted';
  static readonly maxActions = 0;

  static requestPermission(callback?: (permission: string) => void): Promise<string> {
    if (typeof callback === 'function') setTimeout(() => callback('granted'), 0);
    return Promise.resolve('granted');
  }

  readonly permission = 'granted';
  onclick: ((ev: unknown) => void) | null = null;
  onshow: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(title: string, options?: PageNotificationOptions) {
    const payload = {
      title: typeof title === 'string' ? title.slice(0, 120) : String(title ?? '').slice(0, 120),
      body: typeof options?.body === 'string' ? options.body.slice(0, 280) : '',
    };
    try {
      ipcRenderer.send('whatszap:page-notification', payload);
    } catch {
      /* never let the shim break the page */
    }
  }

  close(): void {
    /* no-op: nothing was ever shown */
  }
}

(window as unknown as { Notification: unknown }).Notification = NotificationShim;
