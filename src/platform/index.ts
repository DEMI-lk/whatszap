import { NotificationProvider } from '../notifications/providers/notification-provider';
import { LinuxNotificationProvider } from '../notifications/providers/linux-notification-provider';
import { MacOSNotificationProvider } from '../notifications/providers/macos-notification-provider';
import { WindowsNotificationProvider } from '../notifications/providers/windows-notification-provider';

/**
 * Platform abstraction layer. Core code never branches on process.platform
 * directly; each OS ships its own implementations (placeholders for V1).
 */
export interface PlatformLayer {
  readonly id: 'windows' | 'linux' | 'macos';
  createNotificationProvider(): NotificationProvider;
  /** Future: autostart, tray icon paths, app paths, deep system integration. */
}

export function getPlatform(): PlatformLayer {
  switch (process.platform) {
    case 'win32':
      return { id: 'windows', createNotificationProvider: () => new WindowsNotificationProvider() };
    case 'linux':
      return { id: 'linux', createNotificationProvider: () => new LinuxNotificationProvider() };
    case 'darwin':
      return { id: 'macos', createNotificationProvider: () => new MacOSNotificationProvider() };
    default:
      return { id: 'windows', createNotificationProvider: () => new WindowsNotificationProvider() };
  }
}
