import { NotificationProvider } from '../../notifications/providers/notification-provider';
import { MacOSNotificationProvider } from '../../notifications/providers/macos-notification-provider';

/** Placeholder macOS platform layer (V2). */
export function createMacLayer(): { id: 'macos'; createNotificationProvider(): NotificationProvider } {
  return { id: 'macos', createNotificationProvider: () => new MacOSNotificationProvider() };
}
