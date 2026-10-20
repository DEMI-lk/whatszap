import { Notification } from 'electron';
import { NotificationPayload, NotificationProvider } from './notification-provider';

/** macOS: Electron's NSUserNotification/UNUserNotificationCenter bridge. */
export class MacOSNotificationProvider implements NotificationProvider {
  show(payload: NotificationPayload): void {
    const n = new Notification({
      title: payload.title,
      body: payload.body,
      silent: false,
    });
    if (payload.onClick) n.on('click', () => payload.onClick?.());
    n.show();
  }
}
