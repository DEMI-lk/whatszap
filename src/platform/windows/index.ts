import { ElectronTrayProvider, TrayProvider } from '../tray-provider';

/**
 * Windows tray implementation. Minimal V1: Show + Exit.
 * Kept as its own class (and singleton accessor) because the Windows build
 * uses the original 16px icon sizing expected by the notification area.
 */
export class WindowsTray extends ElectronTrayProvider implements TrayProvider {
  private static instance: WindowsTray | null = null;

  constructor() {
    super(16, false);
  }

  static get(): WindowsTray {
    if (!WindowsTray.instance) WindowsTray.instance = new WindowsTray();
    return WindowsTray.instance;
  }
}
