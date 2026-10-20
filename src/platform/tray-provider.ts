import { app, Menu, nativeImage, Tray } from 'electron';
import * as path from 'node:path';

/**
 * Platform-neutral tray contract. Each platform layer creates its own
 * implementation; core code (main.ts) only sees this interface.
 *
 * Windows keeps its original 16px icon sizing. Linux panels (AppIndicator /
 * StatusNotifier) render best with a slightly larger source image, and may
 * deliver a single left-click instead of a double-click.
 */
export interface TrayProvider {
  show(onShow: () => void, onExit: () => void): void;
  destroy(): void;
}

/** Shared Electron Tray implementation used by the platform layers. */
export class ElectronTrayProvider implements TrayProvider {
  private tray: Tray | null = null;

  constructor(
    private readonly iconSize = 16,
    /** Linux: wire single-click to show (double-click is not delivered). */
    private readonly showOnSingleClick = false,
  ) {}

  show(onShow: () => void, onExit: () => void): void {
    if (this.tray) return;
    // app.getAppPath() resolves to the app root both in dev and packaged
    // builds (process.cwd() does NOT — installed apps launch elsewhere).
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    const image = nativeImage.createFromPath(iconPath).resize({ width: this.iconSize, height: this.iconSize });
    if (image.isEmpty()) {
      console.error(`[tray] icon failed to load: ${iconPath}`);
    }

    try {
      this.tray = new Tray(image);
      this.tray.setToolTip('WhatsZAP');
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Show WhatsZAP', click: onShow },
          { type: 'separator' },
          { label: 'Exit', click: onExit },
        ]),
      );
      this.tray.on('double-click', onShow);
      if (this.showOnSingleClick) this.tray.on('click', onShow);
    } catch (err) {
      // Some Linux desktops ship no StatusNotifier host (GNOME without the
      // AppIndicator extension). Background mode still works; the window is
      // restored by launching WhatsZAP again (single-instance focus).
      console.error('[tray] unavailable on this desktop:', err);
      this.tray = null;
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
