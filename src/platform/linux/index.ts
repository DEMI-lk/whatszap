import { NotificationProvider } from '../../notifications/providers/notification-provider';
import { LinuxNotificationProvider } from '../../notifications/providers/linux-notification-provider';

/** Placeholder Linux platform layer (V2). */
export function createLinuxLayer(): { id: 'linux'; createNotificationProvider(): NotificationProvider } {
  return { id: 'linux', createNotificationProvider: () => new LinuxNotificationProvider() };
}
