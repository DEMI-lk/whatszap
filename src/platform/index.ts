import { NotificationProvider } from '../notifications/providers/notification-provider';
import { WindowsNotificationProvider } from '../notifications/providers/windows-notification-provider';
import { WindowsTray } from './windows';
import { createLinuxLayer } from './linux';
import { createMacLayer } from './macos';
import { TrayProvider } from './tray-provider';

/**
 * Platform abstraction layer. Core code never branches on process.platform
 * directly; each OS ships its own implementations. Windows remains the
 * reference implementation; Linux/macOS provide the same capabilities through
 * Electron's cross-platform APIs.
 */
export interface PlatformLayer {
  readonly id: 'windows' | 'linux' | 'macos';
  createNotificationProvider(): NotificationProvider;
  createTray(): TrayProvider;
  /** Login-item helpers; when absent, Electron's setLoginItemSettings is used. */
  isAutostartEnabled?(): boolean;
  setAutostart?(enabled: boolean): void;
}

export function getPlatform(): PlatformLayer {
  switch (process.platform) {
    case 'linux':
      return createLinuxLayer();
    case 'darwin':
      return createMacLayer();
    case 'win32':
      return {
        id: 'windows',
        createNotificationProvider: () => new WindowsNotificationProvider(),
        createTray: () => WindowsTray.get(),
      };
    default:
      return {
        id: 'windows',
        createNotificationProvider: () => new WindowsNotificationProvider(),
        createTray: () => WindowsTray.get(),
      };
  }
}
