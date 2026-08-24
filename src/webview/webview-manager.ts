import { BrowserWindow, shell, WebContentsView } from 'electron';
import { EventEmitter } from 'node:events';
import { ContentBounds, WHATSAPP_URL } from '../shared/types';
import { SessionManager } from './session-manager';

export interface WebViewEvents {
  'unread-changed': (profileId: string, unread: number) => void;
  'page-title-updated': (profileId: string, title: string) => void;
}

/**
 * Owns the lazily created WebContentsView for every profile and handles
 * attaching/detaching them from the window. Detaching = suspension signal;
 * callers decide whether that means "suspended" or "destroyed".
 */
export class WebviewManager extends EventEmitter {
  private readonly views = new Map<string, WebContentsView>();
  private attachedId: string | null = null;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private hasRealBounds = false;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly sessions: SessionManager,
  ) {
    super();
  }

  hasView(profileId: string): boolean {
    return this.views.has(profileId);
  }

  getView(profileId: string): WebContentsView | undefined {
    return this.views.get(profileId);
  }

  /** Creates (or returns) the view and loads WhatsApp Web if needed. */
  ensureView(profileId: string): WebContentsView {
    let view = this.views.get(profileId);
    if (!view) {
      const ses = this.sessions.forProfile(profileId);
      view = new WebContentsView({
        webPreferences: {
          session: ses,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // No preload: WhatsApp Web gets zero privileged API surface.
          backgroundThrottling: true,
        },
      });
      const wc = view.webContents;
      wc.setUserAgent(ses.getUserAgent());

      wc.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) shell.openExternal(url);
        return { action: 'deny' };
      });

      wc.on('page-title-updated', (_e, title) => {
        const match = /^\((\d+)\)\s*/.exec(title);
        const unread = match ? parseInt(match[1], 10) : 0;
        this.emit('unread-changed', profileId, Number.isNaN(unread) ? 0 : unread);
      });

      wc.on('render-process-gone', (_e, details) => {
        // A crashed renderer must not take the whole profile state machine down.
        console.error(`[webview] renderer gone (${profileId}):`, details.reason);
        if (this.attachedId === profileId) {
          this.detach();
        }
        this.views.delete(profileId);
      });

      this.views.set(profileId, view);

      if (!wc.isLoading() && wc.getURL() === '') {
        void wc.loadURL(WHATSAPP_URL);
      }
    }
    return view;
  }

  setBounds(bounds: ContentBounds): void {
    this.bounds = bounds;
    this.hasRealBounds = bounds.width > 0 && bounds.height > 0;
    const active = this.attachedId ? this.views.get(this.attachedId) : undefined;
    if (!active) return;
    active.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
    active.setVisible(this.hasRealBounds);
  }

  getBounds(): ContentBounds {
    return { ...this.bounds };
  }

  attach(profileId: string): void {
    const win = this.window();
    if (!win) return;
    const view = this.ensureView(profileId);
    if (this.attachedId === profileId && win.contentView.children.includes(view)) {
      this.applyBounds(view);
      return;
    }
    // Attach the incoming view first, then detach the old one: avoids a
    // blank flash while switching between two warm profiles.
    console.info(`[webview] attach ${profileId}`);
    win.contentView.addChildView(view);
    this.applyBounds(view);
    const previous = this.attachedId;
    this.attachedId = profileId;
    if (previous && previous !== profileId) {
      const prevView = this.views.get(previous);
      if (prevView && win.contentView.children.includes(prevView)) {
        win.contentView.removeChildView(prevView);
      }
    }
    view.setVisible(this.hasRealBounds);
  }

  /** Detaches whatever is currently attached (suspension primitive). */
  detach(): void {
    const win = this.window();
    if (!win || !this.attachedId) return;
    const view = this.views.get(this.attachedId);
    this.attachedId = null;
    if (view && win.contentView.children.includes(view)) {
      win.contentView.removeChildView(view);
    }
  }

  /**
   * Fully destroys a profile's WebContents. The persistent session on disk is
   * untouched — recreating the view later restores the logged-in page.
   */
  destroy(profileId: string): void {
    const win = this.window();
    const view = this.views.get(profileId);
    if (!view) return;
    if (win) win.contentView.removeChildView(view);
    if (this.attachedId === profileId) this.attachedId = null;
    this.views.delete(profileId);
    const wc = view.webContents;
    wc.removeAllListeners();
    try {
      // `close()` ends the page like closing a browser tab; fall back to GC
      // dereferencing on builds where it is unavailable.
      type ClosableWebContents = { close?: () => void };
      (wc as unknown as ClosableWebContents).close?.();
    } catch {
      /* GC will reclaim once all references drop */
    }
  }

  reloadActive(): void {
    if (!this.attachedId) return;
    this.views.get(this.attachedId)?.webContents.reload();
  }

  toggleDevToolsActive(): void {
    if (!this.attachedId) return;
    const wc = this.views.get(this.attachedId)?.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  setMuted(profileId: string, muted: boolean): void {
    this.views.get(profileId)?.webContents.setAudioMuted(muted);
  }

  /**
   * Shell overlays (menus/modals) live in the window's HTML layer, which is
   * always BELOW native WebContentsViews — hide the active view while an
   * overlay is open so it stays clickable/visible.
   */
  setActiveVisible(visible: boolean): void {
    if (!this.attachedId) return;
    if (visible && !this.hasRealBounds) return;
    this.views.get(this.attachedId)?.setVisible(visible);
  }

  focusActive(): void {
    if (!this.attachedId) return;
    this.views.get(this.attachedId)?.webContents.focus();
  }

  allIds(): string[] {
    return [...this.views.keys()];
  }

  private applyBounds(view: WebContentsView): void {
    view.setBounds({
      x: this.bounds.x,
      y: this.bounds.y,
      width: Math.max(1, this.bounds.width),
      height: Math.max(1, this.bounds.height),
    });
  }
}

