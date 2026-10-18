import { NotificationProvider } from '../notifications/providers/notification-provider';
import { WindowsNotificationProvider } from '../notifications/providers/windows-notification-provider';
import { createLinuxLayer } from './linux';
import { createMacLayer } from './macos';

/**
 * Platform abstraction layer. Core code never branches on process.platform
 * directly; each OS ships its own implementations (Linux/macOS are V2
 * placeholders, Windows ships the fully supported tray build).
 */
export interface PlatformLayer {
  readonly id: 'windows' | 'linux' | 'macos';
  createNotificationProvider(): NotificationProvider;
  /** Future: autostart, tray icon paths, app paths, deep system integration. */
}

export function getPlatform(): PlatformLayer {
  switch (process.platform) {
    case 'linux':
      return createLinuxLayer();
    case 'darwin':
      return createMacLayer();
    case 'win32':
      return { id: 'windows', createNotificationProvider: () => new WindowsNotificationProvider() };
    default:
      return { id: 'windows', createNotificationProvider: () => new WindowsNotificationProvider() };
  }
}
