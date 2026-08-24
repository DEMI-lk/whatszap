import { app, Menu, nativeImage, Tray } from 'electron';
import * as path from 'node:path';

/** Windows tray implementation. Minimal V1: Show + Exit. */
export class WindowsTray {
  private static instance: WindowsTray | null = null;
  private tray: Tray | null = null;

  static get(): WindowsTray {
    if (!WindowsTray.instance) WindowsTray.instance = new WindowsTray();
    return WindowsTray.instance;
  }

  show(onShow: () => void, onExit: () => void): void {
    if (this.tray) return;
    // app.getAppPath() resolves to the app root both in dev and packaged
    // builds (process.cwd() does NOT — installed apps launch elsewhere).
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (image.isEmpty()) {
      console.error(`[tray] icon failed to load: ${iconPath}`);
    }

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
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
