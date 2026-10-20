import { app, ipcMain } from 'electron';
import * as path from 'node:path';
import { IPC, IPC_EVENTS, Settings } from '../shared/types';
import { ProfileStore } from '../profiles/profile-store';
import { SessionManager } from '../webview/session-manager';
import { WebviewManager } from '../webview/webview-manager';
import { ProfileManager } from './profile-manager';
import { ResourceManager } from './resource-manager';
import { SettingsStore } from './settings-store';
import { WindowManager } from './window-manager';
import { BackgroundManager, ensureSingleInstance } from './background-manager';
import { NotificationManager } from '../notifications/notification-manager';
import { getPlatform } from '../platform';
import { PopoutManager } from './popout-manager';
import { LocalUpdater } from './updater';
import { applyMemoryTuning } from './memory-tuning';
import { sanitizeSettingsPatch } from './ipc-validation';

// Single instance: a second launch must SURFACE the running window, never
// toggle it away (M-5).
const isPrimaryInstance = ensureSingleInstance(() => {
  windows.showAndFocus();
});

if (!isPrimaryInstance) {
  // The lock belongs to the running instance, which the 'second-instance'
  // event has just focused. Quit instead of exiting abruptly (L-14); the
  // timer is a safety net because a pre-ready app.quit() can be ignored.
  app.quit();
  setTimeout(() => app.exit(0), 1000).unref?.();
}

// Windows requires an explicit AppUserModelID for toast notifications; the
// call is a no-op elsewhere, but keep it on its native platform.
if (process.platform === 'win32') app.setAppUserModelId('com.whatszap.app');

// Present as plain Chrome everywhere (headers + navigator.userAgent) BEFORE
// any session/window exists. WhatsApp Web refuses Electron-branded clients.
app.userAgentFallback = SessionManager.chromeUserAgent();

const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'config', 'settings.json'));
const profilesRoot = path.join(app.getPath('userData'), 'profiles');
const store = new ProfileStore(path.join(app.getPath('userData'), 'config', 'profiles.json'));

// Chromium memory profile — before ANY window/session exists, since the
// switches are read while the first renderer is being created.
applyMemoryTuning(app.commandLine, settingsStore.get().memoryMode);

const windows = new WindowManager();
const sessionManager = new SessionManager(profilesRoot);
const webviews = new WebviewManager(() => windows.window, sessionManager);
const notifications = new NotificationManager();
// Platform layer: Windows keeps its tray/window behavior; Linux gets a
// StatusNotifier tray, XDG autostart and native notifications.
const platform = getPlatform();
const tray = platform.createTray();

let resources: ResourceManager;

const profileManager = new ProfileManager(
  store,
  webviews,
  sessionManager,
  () => settingsStore.get(),
  (patch) => {
    const updated = settingsStore.update(patch);
    if (patch.ramLimitMB !== undefined || patch.cpuTargetPercent !== undefined) {
      resources?.updateLimits(updated.ramLimitMB, updated.cpuTargetPercent);
    }
    return updated;
  },
  () => windows.window,
  notifications,
  profilesRoot,
);

resources = new ResourceManager(settingsStore.get(), {
  onRamPressure: () => profileManager.clearInactiveCaches(),
  onCpuSustained: () => profileManager.clearInactiveCaches(),
  clearInactiveCaches: () => profileManager.clearInactiveCaches(),
  destroyOldestInactive: () => profileManager.destroyOldestInactive(),
  inactiveCount: () => profileManager.inactiveCount(),
});

// The renderer subscribes to this push event instead of polling for the chip
// (M-3 — the subscription existed but main never emitted).
resources.onSample = (sample) => {
  const win = windows.window;
  if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENTS.resources, sample);
};

const background = new BackgroundManager(
  () => settingsStore.get().backgroundMode,
  {
    hideToBackground: () => {
      // Suspend renderers while hidden; sessions persist on disk.
      profileManager.suspendAll();
      windows.window?.hide();
      tray.show(
        () => {
          tray.destroy();
          windows.toggle();
        },
        () => background.requestQuit(),
      );
    },
    restoreFromBackground: () => {
      tray.destroy();
      windows.toggle();
    },
    exitApp: () => app.quit(),
  },
);

// Exit menu / tray Exit must bypass close-to-background interception.
profileManager.exitHook = () => background.requestQuit();

// Multi-window mode wiring.
const popouts = new PopoutManager();
profileManager.setPopouts(popouts);
popouts.returnHandler = (id, prevKeepAlive) => profileManager.handlePopoutReturn(id, prevKeepAlive);

// Updater: GitHub Releases channel first (repo is public), local folder as
// fallback/override.
const updater = new LocalUpdater(
  () => settingsStore.get().updatesDir,
  () => background.requestQuit(),
  'DEMI-lk/whatszap',
);
updater.onStatus = (status) => {
  const win = windows.window;
  if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENTS.updaterStatus, status);
};

function registerCoreIpc(): void {
  ipcMain.handle(IPC.getSettings, () => settingsStore.get());
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<Settings>) => {
    // The renderer is the untrusted side of the bridge (L-1): only known keys
    // survive, numbers are clamped, unknown types are dropped.
    const clean = sanitizeSettingsPatch(patch);
    const updated = Object.keys(clean).length > 0 ? settingsStore.update(clean) : settingsStore.get();
    if (clean.startWithWindows !== undefined) applyLoginItem(updated.startWithWindows);
    return updated;
  });
  windows.registerIpc();
  resources.registerIpc();
  ipcMain.handle(IPC.updaterInfo, () => updater.info());
  ipcMain.handle(IPC.updaterCheck, () => updater.check());
  ipcMain.handle(IPC.updaterInstall, () => updater.install());
}

/** Registers/unregisters the OS sign-in launch entry (--hidden). */
function applyLoginItem(enabled: boolean): void {
  if (process.platform === 'linux') {
    // XDG autostart: ~/.config/autostart/whatszap.desktop
    platform.setAutostart?.(enabled);
    return;
  }
  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: enabled });
    } else {
      // Windows: extra args are passed through to the app on launch.
      app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
    }
    console.info(`[startup] login item ${enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    console.error('[startup] setLoginItemSettings failed:', err);
  }
}

function launchedHidden(): boolean {
  return process.argv.includes('--hidden');
}

app.whenReady().then(async () => {
  // A second instance that failed to get the lock must not build any UI; its
  // exit is handled above.
  if (!isPrimaryInstance) return;

  registerCoreIpc();

  // Keep the OS login entry and the stored setting in sync. A stored
  // "on" with no OS entry (reinstall/update) gets re-registered; an entry
  // the user enabled externally gets adopted into settings.
  if (process.platform === 'win32') {
    const actual = app.getLoginItemSettings().openAtLogin;
    const stored = settingsStore.get().startWithWindows;
    if (stored && !actual) applyLoginItem(true);
    else if (!stored && actual) settingsStore.update({ startWithWindows: true });
  } else if (process.platform === 'linux') {
    const actual = platform.isAutostartEnabled?.() ?? false;
    const stored = settingsStore.get().startWithWindows;
    if (stored && !actual) applyLoginItem(true);
    else if (!stored && actual) settingsStore.update({ startWithWindows: true });
  }

  windows.startHidden = launchedHidden();
  const win = windows.create();

  // Reopen path (tray Show, second-instance, activate) all funnel through
  // window 'show' -> ensureActiveAttached -> select(): the same attachment
  // code path as normal profile switching.
  windows.onShow = () => {
    void profileManager.ensureActiveAttached();
  };

  win.on('close', (e) => {
    if (background.shouldInterceptClose()) {
      e.preventDefault();
      background.handleClose();
    }
  });

  profileManager.registerIpc();

  // Renderer -> view bounds sync happens via ProfileManager; kick a first
  // layout once the shell has painted its chrome.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      resources.start();
      void profileManager.bootstrap().then(() => {
        if (windows.startHidden) {
          console.info('[startup] --hidden launch: entering background mode');
          background.enterBackground();
        }
      });
    }, 150);
  });

  // Shortcuts sent by WindowManager land in the shell renderer, which routes
  // them back through the preload API (reload/devtools/profile cycling).

  app.on('activate', () => windows.showAndFocus());
});

app.on('before-quit', () => {
  resources.stop();
  tray.destroy();
  popouts.closeAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
