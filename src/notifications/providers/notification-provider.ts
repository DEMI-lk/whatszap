export interface NotificationPayload {
  title: string;
  body: string;
  onClick?: () => void;
}

/**
 * Platform abstraction so Linux/macOS providers can slot in without touching
 * core code (see platform/).
 */
export interface NotificationProvider {
  show(payload: NotificationPayload): void;
}
