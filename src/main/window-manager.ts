import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { IPC } from '../shared/types';

export const TOPBAR_HEIGHT = 36;

/**
 * Owns the frameless shell window. The renderer draws the chrome (top bar +
 * profile rail) and reports the free content-area rectangle; main positions
 * the active WhatsApp WebContentsView inside it (DIPs == CSS px).
 */
export class WindowManager {
  private win: BrowserWindow | null = null;
  /** Wired by main.ts: fires whenever the window becomes visible again. */
  onShow: (() => void) | null = null;
  /** --hidden launches (Start with Windows): stay in the tray. */
  startHidden = false;

  constructor() {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  create(): BrowserWindow {
    this.win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#111b21',
        symbolColor: '#e9edef',
        height: TOPBAR_HEIGHT,
      },
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

  toggle(): void {
    if (!this.win) return;
    if (this.win.isVisible() && !this.win.isMinimized()) this.win.hide();
    else {
      this.win.show();
      this.win.focus();
    }
  }
}
