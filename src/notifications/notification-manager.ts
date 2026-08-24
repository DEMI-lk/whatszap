import { Notification } from 'electron';
import { NotificationProvider } from './providers/notification-provider';
import { getPlatform } from '../platform';

/**
 * Thin facade over platform notification providers. V1 ships only the
 * Windows provider; Linux/macOS providers are placeholders.
 *
 * Single source of truth for incoming-message toasts: built from the page's
 * captured notification data (sender + content) plus the WhatsZAP profile
 * name, formatted as:
 *   title: <profile name>
 *   body:  <sender's name>\n<content>
 */
export class NotificationManager {
  private provider: NotificationProvider;

  constructor() {
    this.provider = getPlatform().createNotificationProvider();
  }

  showIncoming(
    profileName: string,
    sender: string,
    content: string,
    onClick: () => void,
  ): void {
    if (!Notification.isSupported()) return;
    this.provider.show({
      title: profileName,
      body: `${sender}\n${content}`,
      onClick,
    });
  }
}
