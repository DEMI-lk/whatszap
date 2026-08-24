import { Notification } from 'electron';
import { NotificationPayload, NotificationProvider } from './notification-provider';

/** V1: routes through Electron's native Windows toast notifications. */
export class WindowsNotificationProvider implements NotificationProvider {
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
