import { app, Notification } from 'electron';
import * as path from 'node:path';
import { NotificationPayload, NotificationProvider } from './notification-provider';

/**
 * Linux: Electron routes through the desktop's org.freedesktop.Notifications
 * service (GNOME/KDE/XFCE all implement it), so the same native notification
 * pipeline as Windows works here — with an explicit app icon for panels that
 * don't inherit one from the .desktop file.
 */
export class LinuxNotificationProvider implements NotificationProvider {
  show(payload: NotificationPayload): void {
    const n = new Notification({
      title: payload.title,
      body: payload.body,
      silent: false,
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    });
    if (payload.onClick) n.on('click', () => payload.onClick?.());
    n.show();
  }
}
