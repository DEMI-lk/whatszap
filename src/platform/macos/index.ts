import { NotificationProvider } from '../../notifications/providers/notification-provider';
import { MacOSNotificationProvider } from '../../notifications/providers/macos-notification-provider';
import { ElectronTrayProvider, TrayProvider } from '../tray-provider';

/**
 * macOS platform layer: native notifications + menu-bar tray. Autostart stays
 * on Electron's built-in login-item API (handled in main.ts).
 */
export function createMacLayer(): {
  id: 'macos';
  createNotificationProvider(): NotificationProvider;
  createTray(): TrayProvider;
} {
  return {
    id: 'macos',
    createNotificationProvider: () => new MacOSNotificationProvider(),
    // macOS menu bar renders 18px template-sized icons well.
    createTray: () => new ElectronTrayProvider(18, false),
  };
}
