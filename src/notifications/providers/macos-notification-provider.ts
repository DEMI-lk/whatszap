import { Notification } from 'electron';
import { NotificationPayload, NotificationProvider } from './notification-provider';

/** Placeholder until macOS support lands (V2). */
export class MacOSNotificationProvider implements NotificationProvider {
  show(_payload: NotificationPayload): void {
    // Intentionally unimplemented in V1.
    void Notification.isSupported();
  }
}
