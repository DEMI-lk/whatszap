import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { IPC, IPC_EVENTS } from '../shared/types';

export const TOPBAR_HEIGHT = 36;

/**
 * Owns the frameless shell window. The renderer draws the chrome (top bar +
 * profile rail) and reports the free content-area rectangle; main positions
 * the active WhatsApp WebContentsView inside it (DIPs == CSS px).
 */
export class WindowManager {
  private win: BrowserWindow | null = null;  /** Wired by main.ts: fires whenever the window becomes visible again. */
  onShow: (() => void) | null = null;
  /** --hidden launches (Start with Windows): stay in the tray. */
  startHidden = false;

  constructor() {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  create(): BrowserWindow {
    const isWindows = process.platform === 'win32';
    this.win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      show: false,
      frame: false,
      // titleBarStyle/titleBarOverlay are Windows/macOS chrome options. On
      // Linux frame:false removes decorations entirely, so the renderer draws
      // its own minimise/maximise/close buttons instead (see renderer/).
      titleBarStyle: 'hidden',
      ...(isWindows
        ? {
            titleBarOverlay: {
              color: '#111b21',
              symbolColor: '#e9edef',
              height: TOPBAR_HEIGHT,
            },
          }
        : {}),
      backgroundColor: '#0b141a',
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false, // shell must stay responsive when hidden
      },
    });

    void this.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    this.win.once('ready-to-show', () => {
      if (!this.startHidden) this.win?.show();
    });
    this.win.on('show', () => this.onShow?.());
    // Never hand a destroyed BrowserWindow to late async handlers (renderer
    // crash events, timers): `window` must become null the moment it closes.
    this.win.on('closed', () => {
      this.win = null;
    });

    // Keep the renderer's custom title-bar buttons in sync with the real
    // window state (Linux has no native overlay to draw them).
    this.win.on('maximize', () => this.sendWindowState(true));
    this.win.on('unmaximize', () => this.sendWindowState(false));

    this.win.on('enter-html-full-screen', () => {
      this.win?.webContents.send(IPC.chromeVisibility, false);
    });
    this.win.on('leave-html-full-screen', () => {
      this.win?.webContents.send(IPC.chromeVisibility, true);
    });

    // Local accelerators without a native menu bar.
    this.win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const wc = this.win?.webContents;
      const ctrl = input.control || input.meta;
      if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
        wc?.send('shortcut:reload');
      } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
        wc?.send('shortcut:devtools');
      } else if (ctrl && input.key === 'Tab') {
        wc?.send(input.shift ? 'shortcut:profile-prev' : 'shortcut:profile-next');
      } else if (ctrl && /^[0-9]$/.test(input.key)) {
        // Ctrl+1..9 jump to profiles 1..9, Ctrl+0 to the 10th.
        wc?.send('shortcut:profile-index', input.key === '0' ? 10 : parseInt(input.key, 10));
      }
    });

    return this.win;
  }

  /** Registers the Linux custom-title-bar window controls (harmless elsewhere). */
  registerIpc(): void {
    ipcMain.handle(IPC.platformInfo, () => ({
      platform: process.platform,
      // Windows/macOS draw native overlay buttons; Linux needs the renderer's.
      customWindowControls: process.platform === 'linux',
    }));
    ipcMain.handle(IPC.windowMinimize, () => {
      this.win?.minimize();
    });
    ipcMain.handle(IPC.windowMaximizeToggle, () => {
      if (!this.win) return false;
      if (this.win.isMaximized()) this.win.unmaximize();
      else this.win.maximize();
      return this.win.isMaximized();
    });
    // Route through close() so background-mode interception still applies.
    ipcMain.handle(IPC.windowClose, () => {
      this.win?.close();
    });
  }

  private sendWindowState(maximized: boolean): void {
    const wc = this.win?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(IPC_EVENTS.windowState, maximized);
  }

  /**
   * Bring the window back from hidden/minimised and focus it. Used for
   * second-instance and macOS activate — `toggle()` would HIDE a visible
   * window there, which is the opposite of what a second launch means.
   */
  showAndFocus(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  toggle(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isVisible() && !this.win.isMinimized()) this.win.hide();
    else {
      this.win.show();
      this.win.focus();
    }
  }
}
