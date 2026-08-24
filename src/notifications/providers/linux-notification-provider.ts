import { Notification } from 'electron';
import { NotificationPayload, NotificationProvider } from './notification-provider';

/** Placeholder until Linux support lands (V2). */
export class LinuxNotificationProvider implements NotificationProvider {
  show(_payload: NotificationPayload): void {
    // Intentionally unimplemented in V1.
    void Notification.isSupported();
  }
}
