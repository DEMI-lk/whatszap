import { app, BrowserWindow, dialog, ipcMain, nativeImage, WebContentsView } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContentBounds, IPC, IPC_EVENTS, MAX_PROFILES, ProfileInfo, ProfileMeta, Settings, WHATSAPP_URL } from '../shared/types';
import { ProfileSession, transition } from '../profiles/profile-session';
import { ProfileStore } from '../profiles/profile-store';
import { SessionManager } from '../webview/session-manager';
import { WebviewManager } from '../webview/webview-manager';
import { NotificationManager } from '../notifications/notification-manager';
import { PopoutManager } from './popout-manager';

/**
 * Central orchestrator: owns every ProfileSession, wires store + sessions +
 * webviews together, and exposes the IPC surface used by the renderer shell.
 */
export class ProfileManager {
  private readonly sessionsMap = new Map<string, ProfileSession>();
  private activeId: string | null = null;
  private snapshotWindow: NodeJS.Timeout | null = null;
  private popouts: PopoutManager | null = null;
  /** Serializes select() so concurrent activations can't interleave. */
  private selectQueue: Promise<void> = Promise.resolve();
  private suspendedOrder(): ProfileSession[] {
    return [...this.sessionsMap.values()]
      .filter((s) => s.state === 'suspended')
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  }

  constructor(
    private readonly store: ProfileStore,
    private readonly webviews: WebviewManager,
    private readonly sessions: SessionManager,
    private readonly settings: () => Settings,
    private readonly saveSettings: (patch: Partial<Settings>) => void,
    private readonly window: () => BrowserWindow | null,
    private readonly notifications: NotificationManager,
    private readonly profilesRoot: string,
  ) {
    for (const meta of store.list()) {
      // Migrate pre-V1.2 metadata: undefined keepAlive meant "stays resident",
      // so preserve that behavior instead of forcing new defaults on upgrades.
      meta.keepAlive = meta.keepAlive ?? true;
      this.sessionsMap.set(meta.id, new ProfileSession(meta));
    }

    webviews.on('unread-changed', (profileId: string, unread: number) => {
      this.onUnreadChanged(profileId, unread);
    });
  }

  setPopouts(popouts: PopoutManager): void {
    this.popouts = popouts;
  }

  // ------------------------------------------------------------------ public

  registerIpc(): void {
    ipcMain.handle(IPC.getProfiles, () => this.snapshot());
    ipcMain.handle(IPC.getStateSnapshot, () => this.snapshot());
    ipcMain.handle(IPC.selectProfile, (_e, id: string) => {
      void this.select(id).catch((err) => console.error('[profiles] select failed:', err));
    });
    ipcMain.handle(IPC.createProfile, (_e, name?: string) => this.create(name));
    ipcMain.handle(IPC.renameProfile, (_e, id: string, name: string) => this.rename(id, name));
    ipcMain.handle(IPC.deleteProfile, async (_e, id: string) => {
      await this.deleteProfile(id);
    });
    ipcMain.handle(IPC.pickAvatar, (_e, id: string) => this.pickAvatar(id));
    ipcMain.handle(IPC.setBuiltinAvatar, (_e, id: string, avatarId: string) => {
      this.setBuiltinAvatar(id, avatarId);
    });
    ipcMain.handle(IPC.removeAvatar, (_e, id: string) => {
      this.store.update(id, { avatar: null });
      this.emitSnapshot();
    });
    ipcMain.handle(IPC.setKeepAlive, (_e, id: string, keepAlive: boolean) => {
      this.setKeepAlive(id, keepAlive);
    });
    ipcMain.handle(IPC.popoutProfile, (_e, id: string) => {
      void this.popout(id).catch((err) => console.error(`[popout] ${id} failed:`, err));
    });
    ipcMain.handle(IPC.popinProfile, (_e, id: string) => this.popouts?.close(id));
    ipcMain.handle(IPC.contentBounds, (_e, bounds: ContentBounds) => this.setBounds(bounds));
    ipcMain.handle(IPC.reloadActive, () => this.webviews.reloadActive());
    ipcMain.handle(IPC.toggleDevTools, () => this.webviews.toggleDevToolsActive());
    ipcMain.handle(IPC.setViewVisible, (_e, visible: boolean) => this.webviews.setActiveVisible(visible));
    ipcMain.handle(IPC.exitApp, () => this.forceExit());
    ipcMain.on('whatszap:page-notification', (event, payload) => {
      try {
        this.onPageNotification(event as Electron.IpcMainEvent, payload);
      } catch (err) {
        console.error('[notifications] page notification failed:', err);
      }
    });
  }

  /** Restores last active profile after boot; first run auto-creates one. */
  async bootstrap(): Promise<void> {
    const lastId = this.settings().activeProfileId;
    if (lastId && this.sessionsMap.has(lastId)) {
      await this.select(lastId);
    } else {
      const list = this.list();
      if (list.length === 1) {
        await this.select(list[0].id);
      } else if (list.length === 0) {
        this.create('Profile 1');
      }
    }
    // Bring keep-alive (Active) profiles online in the background so they
    // stay connected for notifications.
    void this.warmKeepAliveProfiles();
  }

  list(): ProfileSession[] {
    return [...this.sessionsMap.values()];
  }

  count(): number {
    return this.store.count();
  }

  maxProfiles(): number {
    return Math.min(MAX_PROFILES, this.settings().maxProfiles || MAX_PROFILES);
  }

  get active(): ProfileSession | null {
    return this.activeId ? this.sessionsMap.get(this.activeId) ?? null : null;
  }

  async select(id: string): Promise<void> {
    const run = this.selectQueue.then(() => this.selectInner(id));
    this.selectQueue = run.catch((err) =>
      console.error(`[profiles] select(${id}) failed:`, err instanceof Error ? err.message : err),
    );
    return run;
  }

  private async selectInner(id: string): Promise<void> {
    const target = this.sessionsMap.get(id);
    if (!target) throw new Error(`Unknown profile: ${id}`);
    if (this.activeId === id && target.state === 'active') return;
    // Popped-out profiles are managed by their own window; clicking their
    // circle focuses that window instead of pulling them into the shell.
    if (this.popouts?.isPopped(id)) {
      this.popouts.focus(id);
      return;
    }

    console.info(`[profiles] select ${id} (from state: ${target.state})`);

    // Bring the incoming view up first so switching between two warm
    // profiles never shows an empty content area.
    const view = this.webviews.ensureView(id);
    if (target.state === 'destroyed' || view.webContents.getURL() === '') {
      transition(target, 'loading');
      this.emitSnapshot();
      await this.loadWhatsApp(view);
    }
    // The user may have popped this profile out while it was still loading.
    if (this.popouts?.isPopped(id)) return;

    this.webviews.attach(id);
    this.webviews.setMuted(id, false);

    const previous = this.activeId !== id ? this.active : null;
    this.activeId = id;
    if (target.state !== 'active') transition(target, 'active');
    this.saveSettings({ activeProfileId: id });

    if (previous) this.suspend(previous);
    this.webviews.focusActive();
    this.emitSnapshot();
    console.info(`[profiles] ${id} active${previous ? ` (suspended ${previous.id})` : ''}`);
  }

  create(name?: string): ProfileInfo | null {
    if (this.count() >= this.maxProfiles()) {
      console.warn(`[profiles] create rejected: limit ${this.maxProfiles()} reached`);
      return null;
    }
    const meta: ProfileMeta = {
      id: this.store.nextProfileId(),
      name: (name ?? '').trim() || `Profile ${this.store.count() + 1}`,
      avatar: null,
      createdAt: Date.now(),
      // Conservative default: only the very first profile starts Active;
      // everything else defaults to Sleep (RAM safety over convenience).
      keepAlive: this.store.count() === 0,
    };
    this.store.add(meta);
    const sessionRec = new ProfileSession(meta);
    this.sessionsMap.set(meta.id, sessionRec);
    console.info(`[profiles] created ${meta.id} "${meta.name}"`);
    void this.select(meta.id);
    return this.toInfo(sessionRec);
  }

  rename(id: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.store.update(id, { name: clean });
    const rec = this.sessionsMap.get(id);
    if (rec) rec.meta.name = clean;
    this.emitSnapshot();
  }

  /** Removes metadata AND its browser-data directory (explicit user action). */
  async deleteProfile(id: string): Promise<void> {
    const rec = this.sessionsMap.get(id);
    if (!rec) return;
    if (this.popouts?.isPopped(id)) {
      // Detach the return handler so closing the pop-out window doesn't
      // resurrect state for a profile we're deleting.
      this.popouts.close(id);
      await new Promise((r) => setTimeout(r, 50));
    }
    if (rec.state === 'active') {
      const others = this.suspendedOrder();
      this.webviews.detach();
      this.activeId = null;
      if (others.length > 0) await this.select(others[others.length - 1].id);
    }
    this.webviews.destroy(id);
    this.sessionsMap.delete(id);
    this.store.remove(id);
    try {
      fs.rmSync(path.join(this.profilesRoot, id), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    this.saveSettings({ activeProfileId: this.activeId });
    this.emitSnapshot();
  }

  async pickAvatar(id: string): Promise<string | null> {
    const win = this.window();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose avatar image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    const file = result.filePaths[0];
    if (!file) return null;
    return this.setCustomAvatar(id, file);
  }

  /**
   * Center-crops the source image to a square and saves a 256x256 PNG copy
   * inside the profile's own data directory, so the avatar survives the
   * original file being moved/deleted. Animated sources become static.
   */
  setCustomAvatar(id: string, sourceFile: string): string | null {
    const rec = this.sessionsMap.get(id);
    if (!rec) return null;
    const img = nativeImage.createFromPath(sourceFile);
    if (img.isEmpty()) {
      console.error(`[avatars] unreadable image: ${sourceFile}`);
      return null;
    }
    const { width, height } = img.getSize();
    const side = Math.min(width, height);
    const cropped = img
      .crop({
        x: Math.floor((width - side) / 2),
        y: Math.floor((height - side) / 2),
        width: side,
        height: side,
      })
      .resize({ width: 256, height: 256 });

    const dir = path.join(this.profilesRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    // Fixed name: replaces any previous custom avatar (old ext included).
    for (const old of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^avatar\./.test(old)) fs.rmSync(path.join(dir, old), { force: true });
    }
    const dest = path.join(dir, 'avatar.png');
    fs.writeFileSync(dest, cropped.toPNG());

    rec.meta.avatar = dest;
    this.store.update(id, { avatar: dest });
    this.emitSnapshot();
    return dest;
  }

  /** Built-in avatar reference (builtin:1..8) — no image is copied. */
  setBuiltinAvatar(id: string, avatarId: string): void {
    const rec = this.sessionsMap.get(id);
    if (!rec) return;
    if (!/^builtin:[1-8]$/.test(avatarId)) {
      console.warn(`[avatars] invalid builtin id: ${avatarId}`);
      return;
    }
    rec.meta.avatar = avatarId;
    this.store.update(id, { avatar: avatarId });
    this.emitSnapshot();
  }

  setBounds(bounds: ContentBounds): void {
    this.webviews.setBounds(bounds);
  }

  /**
   * Resource-pressure hook: destroys the oldest suspended SLEEP profile's
   * WebContents. Keep-alive profiles are exempt — Active/Sleep is a user
   * decision, never one made by the resource monitor. Persistent session
   * data survives. Returns the victim id (or null) for logging.
   */
  destroyOldestInactive(): string | null {
    const candidates = this.suspendedOrder().filter((r) => !r.meta.keepAlive);
    if (candidates.length === 0) return null;
    const victim = candidates[0];
    console.info(`[resources] destroying oldest inactive profile ${victim.id}`);
    transition(victim, 'destroyed');
    this.webviews.destroy(victim.id);
    this.emitSnapshot();
    return victim.id;
  }

  clearInactiveCaches(): void {
    const ids = this.suspendedOrder().map((r) => r.id);
    if (ids.length === 0) return;
    console.info(`[resources] clearing caches for inactive profiles: ${ids.join(', ')}`);
    for (const rec of this.suspendedOrder()) {
      void this.sessions.clearCache(rec.id);
    }
  }

  inactiveCount(): number {
    return this.suspendedOrder().length;
  }

  /**
   * Background mode: suspend or destroy every focused profile (per its
   * Active/Sleep choice). Keep-alive profiles stay resident in the tray so
   * notifications keep working; sleep profiles are destroyed. The last
   * active profile id is KEPT in settings so reopening can restore it.
   */
  suspendAll(): void {
    for (const rec of this.list()) {
      if (rec.state !== 'active') continue;
      if (this.popouts?.isPopped(rec.id)) continue;
      this.webviews.setMuted(rec.id, true);
      if (rec.meta.keepAlive) {
        transition(rec, 'suspended');
      } else {
        transition(rec, 'destroyed');
        this.webviews.destroy(rec.id);
      }
    }
    this.webviews.detach();
    this.activeId = null;
    this.emitSnapshot();
  }

  /**
   * Explicit per-profile Active/Sleep toggle (user action from the circle
   * menu). Toggling ON wakes a destroyed profile in the background; toggling
   * OFF puts a non-focused profile to sleep immediately.
   */
  setKeepAlive(id: string, keepAlive: boolean): void {
    const rec = this.sessionsMap.get(id);
    if (!rec) return;
    if (this.popouts?.isPopped(id)) {
      console.warn(`[profiles] ${id} is popped out; its state follows the window`);
      return;
    }
    rec.meta.keepAlive = keepAlive;
    this.store.update(id, { keepAlive });
    console.info(`[profiles] ${id} -> ${keepAlive ? 'ACTIVE (keep alive)' : 'SLEEP'}`);

    if (keepAlive && rec.state === 'destroyed') {
      void this.warm(rec);
    } else if (!keepAlive && rec.state === 'suspended') {
      transition(rec, 'destroyed');
      this.webviews.destroy(id);
    }
    this.emitSnapshot();
  }

  /** Wake path reused for boot warm-up and keep-alive toggling. */
  private async warm(rec: ProfileSession): Promise<void> {
    if (rec.state !== 'destroyed') return;
    console.info(`[profiles] warming keep-alive profile ${rec.id}`);
    const view = this.webviews.ensureView(rec.id);
    transition(rec, 'loading');
    this.emitSnapshot();
    await this.loadWhatsApp(view);
    // (Cast: transition() mutated the state at runtime; TS narrowing can't see it.)
    if ((rec.state as ProfileSession['state']) === 'loading') {
      transition(rec, 'suspended');
      this.webviews.setMuted(rec.id, true);
    }
    this.emitSnapshot();
  }

  private async warmKeepAliveProfiles(): Promise<void> {
    for (const rec of this.list()) {
      if (!rec.meta.keepAlive) continue;
      if (rec.id === this.activeId) continue;
      if (this.popouts?.isPopped(rec.id)) continue;
      try {
        await this.warm(rec);
      } catch (err) {
        console.error(`[profiles] warm ${rec.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Multi-window: reparent the profile's WebContentsView into its own OS
   * window. Popped profiles are implicitly keep-alive; the previous value is
   * restored when the window closes.
   */
  async popout(id: string): Promise<void> {
    const rec = this.sessionsMap.get(id);
    if (!rec) return;
    if (!this.popouts) throw new Error('PopoutManager not wired');
    if (this.popouts.isPopped(id)) {
      this.popouts.focus(id);
      return;
    }
    if (rec.state === 'loading') {
      console.info(`[popout] ${id} is still loading; try again in a moment`);
      return;
    }

    const view = this.webviews.ensureView(id);
    const wasActive = this.activeId === id;
    if (wasActive) {
      this.webviews.detach();
      this.activeId = null;
    } else if (rec.state === 'destroyed' || view.webContents.getURL() === '') {
      transition(rec, 'loading');
      this.emitSnapshot();
      await this.loadWhatsApp(view);
    }

    const prevKeepAlive = rec.meta.keepAlive;
    this.popouts.open(id, view, rec.meta.name, prevKeepAlive);

    // Implicit Active while popped (explicit user action: popping out).
    rec.meta.keepAlive = true;
    this.store.update(id, { keepAlive: true });
    if (rec.state !== 'active') transition(rec, 'active');
    this.webviews.setMuted(id, false);

    this.saveSettings({ activeProfileId: this.activeId });
    this.emitSnapshot();
    console.info(`[popout] ${id} now in its own window (previous state: ${prevKeepAlive ? 'keep-alive' : 'sleep'})`);
  }

  /** Called by PopoutManager when a pop-out window closes. */
  handlePopoutReturn(id: string, prevKeepAlive: boolean): void {
    const rec = this.sessionsMap.get(id);
    if (!rec) return; // profile was deleted while popped
    rec.meta.keepAlive = prevKeepAlive;
    this.store.update(id, { keepAlive: prevKeepAlive });

    if (rec.state === 'active') {
      if (prevKeepAlive) {
        transition(rec, 'suspended');
        this.webviews.setMuted(id, true);
      } else {
        transition(rec, 'destroyed');
        this.webviews.destroy(id);
      }
    }
    console.info(`[popout] ${id} returned to ${prevKeepAlive ? 'keep-alive' : 'sleep'}`);
    this.emitSnapshot();
  }

  /**
   * Single reattachment path used on window show/restore: if no profile is
   * currently active, bring back the last active one through select().
   */
  async ensureActiveAttached(): Promise<void> {
    if (this.active) return;
    const last = this.settings().activeProfileId;
    if (last && this.sessionsMap.has(last)) {
      console.info(`[profiles] restoring last active profile: ${last}`);
      await this.select(last);
    }
  }

  forceExit(): void {
    this.exitHook();
  }

  /** Wired by main.ts so Exit cooperates with background-mode interception. */
  exitHook: () => void = () => app.exit(0);

  // ------------------------------------------------------- notification path

  /** Per-profile burst guard for unified message toasts. */
  private readonly lastNotifyAt = new Map<string, number>();

  /**
   * Single notification source: the page's Notification calls are captured
   * by the shim preload and arrive here with sender (title) + content
   * (body). WhatsZAP attaches the profile name and shows exactly one toast.
   */
  private onPageNotification(
    event: Electron.IpcMainEvent,
    payload: { title?: unknown; body?: unknown },
  ): void {
    const profileId = this.webviews.profileIdByWebContents(event.sender.id);
    if (!profileId) return;
    const rec = this.sessionsMap.get(profileId);
    if (!rec) return;

    // Suppress only when the user is actively looking at this profile.
    if (this.activeId === profileId && this.window()?.isFocused()) return;
    if (this.popouts?.isPopped(profileId) && this.popouts.isFocused(profileId)) return;

    const now = Date.now();
    const last = this.lastNotifyAt.get(profileId) ?? 0;
    if (now - last < 1000) return; // burst guard for rapid message runs
    this.lastNotifyAt.set(profileId, now);

    const sender = typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim().slice(0, 100)
      : 'New message';
    const content = typeof payload?.body === 'string' ? payload.body.trim().slice(0, 200) : '';

    this.notifications.showIncoming(rec.meta.name, sender, content, () =>
      this.focusProfile(profileId),
    );
  }

  /** Notification click: focus the popped window or the shell on profile. */
  private focusProfile(id: string): void {
    if (this.popouts?.isPopped(id)) {
      this.popouts.focus(id);
      return;
    }
    const win = this.window();
    if (win) {
      win.show();
      win.focus();
    }
    if (this.activeId !== id) void this.select(id);
  }

  // ----------------------------------------------------------------- private

  private suspend(rec: ProfileSession): void {
    if (rec.state !== 'active') return;
    this.webviews.setMuted(rec.id, true);
    // Active (keep-alive) profiles stay resident but detached; Sleep
    // profiles are fully destroyed — the login persists on disk either way.
    if (rec.meta.keepAlive && !this.popouts?.isPopped(rec.id)) {
      transition(rec, 'suspended');
    } else if (!this.popouts?.isPopped(rec.id)) {
      transition(rec, 'destroyed');
      this.webviews.destroy(rec.id);
    }
  }
  private loadWhatsApp(view: WebContentsView): Promise<void> {
    const wc = view.webContents;
    if (wc.getURL().startsWith(WHATSAPP_URL)) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        wc.removeListener('did-finish-load', done);
        console.info(`[webview] did-finish-load: ${wc.getURL() || '(empty)'}`);
        resolve();
      };
      wc.once('did-finish-load', done);
      wc.once('did-fail-load', (_e, code, desc, url, isMain) => {
        if (isMain && !settled) {
          console.error(`[webview] did-fail-load (${code} ${desc}): ${url}`);
        }
      });
      void wc.loadURL(WHATSAPP_URL).catch((err) =>
        console.error('[webview] loadURL rejected:', err instanceof Error ? err.message : err),
      );
      // Never hang forever on slow networks.
      setTimeout(() => {
        if (!settled) {
          console.warn('[webview] load timeout (20s) — attaching anyway');
          done();
        }
      }, 20000).unref?.();
    });
  }

  private onUnreadChanged(profileId: string, unread: number): void {
    const rec = this.sessionsMap.get(profileId);
    if (!rec) return;
    rec.unread = unread;
    // NOTE: notifications are NOT raised here anymore — the shim-captured
    // page notification (onPageNotification) is the single toast source.
    this.emitSnapshotThrottled();
  }

  private toInfo(rec: ProfileSession): ProfileInfo {
    return {
      id: rec.meta.id,
      name: rec.meta.name,
      avatarRaw: rec.meta.avatar,
      avatarDataUrl: this.resolveAvatar(rec.meta.avatar),
      initials: initialsOf(rec.meta.name),
      state: rec.state,
      unread: rec.unread,
      keepAlive: rec.meta.keepAlive,
      poppedOut: this.popouts?.isPopped(rec.id) ?? false,
    };
  }

  /** Bundled built-in avatars, read once and cached as data URLs. */
  private readonly builtinAvatarCache = new Map<string, string>();

  private resolveAvatar(avatar: string | null): string | null {
    if (!avatar) return null;
    if (avatar.startsWith('builtin:')) {
      const cached = this.builtinAvatarCache.get(avatar);
      if (cached) return cached;
      try {
        const file = path.join(app.getAppPath(), 'assets', 'avatars', `${avatar.slice(8)}.png`);
        const url = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
        this.builtinAvatarCache.set(avatar, url);
        return url;
      } catch {
        return null;
      }
    }
    return readAvatarDataUrl(avatar);
  }

  private snapshot(): ProfileInfo[] {
    return this.list()
      .sort((a, b) => a.meta.createdAt - b.meta.createdAt)
      .map((r) => this.toInfo(r));
  }

  emitSnapshot(): void {
    const win = this.window();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.snapshot, this.snapshot());
    }
  }

  private emitSnapshotThrottled(): void {
    if (this.snapshotWindow) return;
    this.snapshotWindow = setTimeout(() => {
      this.snapshotWindow = null;
      this.emitSnapshot();
    }, 250);
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function readAvatarDataUrl(p: string | null): string | null {
  if (!p) return null;
  try {
    const data = fs.readFileSync(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}
