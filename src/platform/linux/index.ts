import { NotificationProvider } from '../../notifications/providers/notification-provider';
import { LinuxNotificationProvider } from '../../notifications/providers/linux-notification-provider';
import { TrayProvider } from '../tray-provider';
import { LinuxTray } from './tray';
import { isLinuxAutostartEnabled, setLinuxAutostart } from './autostart';

/**
 * Linux platform layer: native notifications, StatusNotifier tray, XDG
 * autostart. Imported lazily by getPlatform(), so Windows builds never load
 * the XDG code paths.
 */
export function createLinuxLayer(): {
  id: 'linux';
  createNotificationProvider(): NotificationProvider;
  createTray(): TrayProvider;
  isAutostartEnabled(): boolean;
  setAutostart(enabled: boolean): void;
} {
  return {
    id: 'linux',
    createNotificationProvider: () => new LinuxNotificationProvider(),
    createTray: () => new LinuxTray(),
    isAutostartEnabled: () => isLinuxAutostartEnabled(),
    setAutostart: (enabled: boolean) => setLinuxAutostart(enabled),
  };
}
