import { app, BrowserWindow, WebContentsView } from 'electron';
import * as path from 'node:path';

interface PopoutEntry {
  win: BrowserWindow;
  view: WebContentsView;
  prevKeepAlive: boolean;
  onResize: () => void;
}

/**
 * Multi-window mode: pops a profile's WebContentsView into its own OS window
 * by reparenting the existing view (no reload). A popped profile is
 * implicitly keep-alive; closing the window hands the profile back to
 * ProfileManager via `returnHandler`, restoring its previous Active/Sleep
 * choice.
 */
export class PopoutManager {
  private readonly entries = new Map<string, PopoutEntry>();

  /** Wired by main.ts -> ProfileManager.handlePopoutReturn. */
  returnHandler: ((profileId: string, prevKeepAlive: boolean) => void) | null = null;

  isPopped(profileId: string): boolean {
    return this.entries.has(profileId);
  }

  poppedIds(): string[] {
    return [...this.entries.keys()];
  }

  focus(profileId: string): void {
    const entry = this.entries.get(profileId);
    if (!entry) return;
    if (entry.win.isMinimized()) entry.win.restore();
    entry.win.show();
    entry.win.focus();
  }

  isFocused(profileId: string): boolean {
    return this.entries.get(profileId)?.win.isFocused() ?? false;
  }

  open(profileId: string, view: WebContentsView, title: string, prevKeepAlive: boolean): void {
    if (this.entries.has(profileId)) {
      this.focus(profileId);
      return;
    }
    const win = new BrowserWindow({
      width: 440,
      height: 700,
      minWidth: 320,
      minHeight: 480,
      title,
      autoHideMenuBar: true,
      backgroundColor: '#0b141a',
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    });
    win.setMenuBarVisibility(false);

    win.contentView.addChildView(view);
    const onResize = () => {
      if (win.isDestroyed()) return;
      const size = win.getContentSize();
      view.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
    };
    onResize();
    win.on('resize', onResize);

    win.on('closed', () => {
      const entry = this.entries.get(profileId);
      if (!entry) return;
      this.entries.delete(profileId);
      this.returnHandler?.(profileId, entry.prevKeepAlive);
    });

    this.entries.set(profileId, { win, view, prevKeepAlive, onResize });
    win.show();
    view.webContents.focus();
    console.info(`[popout] opened window for ${profileId}`);
  }

  /** Explicit close (tray/menu); the 'closed' event runs the return path. */
  close(profileId: string): void {
    this.entries.get(profileId)?.win.close();
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }
}
