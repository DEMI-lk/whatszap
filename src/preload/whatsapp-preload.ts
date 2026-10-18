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

/**
 * Font override: message text (`selectable-text` is WhatsApp's class for it)
 * is rendered with Nirmala UI so Sinhala and other Indic scripts shape
 * correctly instead of falling back to a mismatched font. The view shares the
 * page's world (contextIsolation off), so this is a plain DOM patch.
 */
const FONT_OVERRIDE_CSS = `
.selectable-text,
.selectable-text span {
  font-family: "Nirmala UI", sans-serif !important;
  font-style: normal;
  font-weight: 400;
}
`;

const FONT_STYLE_ID = 'whatszap-font-overrides';

function applyFontOverrides(): void {
  if (document.getElementById(FONT_STYLE_ID)) return;
  const target = document.head ?? document.documentElement;
  if (!target) return;
  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = FONT_OVERRIDE_CSS;
  target.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyFontOverrides, { once: true });
} else {
  applyFontOverrides();
}
