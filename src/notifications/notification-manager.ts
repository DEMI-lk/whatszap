import { Notification, BrowserWindow } from 'electron';
import { NotificationProvider } from './providers/notification-provider';
import { getPlatform } from '../platform';

/**
 * Thin facade over platform notification providers. V1 ships only the
 * Windows provider; Linux/macOS providers are placeholders.
 */
export class NotificationManager {
  private provider: NotificationProvider;

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.provider = getPlatform().createNotificationProvider();
  }

  showProfileUnread(profileName: string, unread: number): void {
    if (!Notification.isSupported()) return;
    const win = this.getWindow();
    // Never toast for the profile the user is looking at.
    if (win?.isFocused()) return;
    this.provider.show({
      title: 'WhatsZAP',
      body: `${profileName}: ${unread} new message${unread === 1 ? '' : 's'}`,
      onClick: () => {
        win?.show();
        win?.focus();
      },
    });
  }
}
