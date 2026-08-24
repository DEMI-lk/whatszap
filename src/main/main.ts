import { app, ipcMain } from 'electron';
import * as path from 'node:path';
import { IPC, IPC_EVENTS, Settings } from '../shared/types';
import { ProfileStore } from '../profiles/profile-store';
import { SessionManager } from '../webview/session-manager';import { WebviewManager } from '../webview/webview-manager';
import { ProfileManager } from './profile-manager';
import { ResourceManager } from './resource-manager';
import { SettingsStore } from './settings-store';
import { WindowManager } from './window-manager';
import { BackgroundManager, ensureSingleInstance } from './background-manager';
import { NotificationManager } from '../notifications/notification-manager';
import { WindowsTray } from '../platform/windows';
import { PopoutManager } from './popout-manager';
import { LocalUpdater } from './updater';

if (!ensureSingleInstance(() => {
  windows.toggle();
})) {
  process.exit(0);
}

app.setAppUserModelId('com.whatszap.app'); // required for Windows toasts

// Present as plain Chrome everywhere (headers + navigator.userAgent) BEFORE
// any session/window exists. WhatsApp Web refuses Electron-branded clients.
app.userAgentFallback = SessionManager.chromeUserAgent();

const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'config', 'settings.json'));
const profilesRoot = path.join(app.getPath('userData'), 'profiles');
const store = new ProfileStore(path.join(app.getPath('userData'), 'config', 'profiles.json'));

const windows = new WindowManager();
const sessionManager = new SessionManager(profilesRoot);
const webviews = new WebviewManager(() => windows.window, sessionManager);
const notifications = new NotificationManager(() => windows.window);

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

const background = new BackgroundManager(
  () => settingsStore.get().backgroundMode,
  {
    hideToBackground: () => {
      // Suspend renderers while hidden; sessions persist on disk.
      profileManager.suspendAll();
      windows.window?.hide();
      WindowsTray.get().show(
        () => {
          WindowsTray.get().destroy();
          windows.toggle();
        },
        () => background.requestQuit(),
      );
    },
    restoreFromBackground: () => {
      WindowsTray.get().destroy();
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

// Local-folder updater (Settings -> Updates).
const updater = new LocalUpdater(
  () => settingsStore.get().updatesDir,
  () => background.requestQuit(),
);
updater.onStatus = (status) => {
  const win = windows.window;
  if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENTS.updaterStatus, status);
};

function registerCoreIpc(): void {
  ipcMain.handle(IPC.getSettings, () => settingsStore.get());
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<Settings>) => {
    const updated = settingsStore.update(patch);
    if (patch.startWithWindows !== undefined) applyLoginItem(updated.startWithWindows);
    return updated;
  });
  resources.registerIpc();
  ipcMain.handle(IPC.updaterInfo, () => updater.info());
  ipcMain.handle(IPC.updaterCheck, () => updater.check());
  ipcMain.handle(IPC.updaterInstall, () => updater.install());
}

/** Registers/unregisters the Windows sign-in launch entry (--hidden). */
function applyLoginItem(enabled: boolean): void {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
    console.info(`[startup] login item ${enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    console.error('[startup] setLoginItemSettings failed:', err);
  }
}

function launchedHidden(): boolean {
  return process.argv.includes('--hidden');
}

app.whenReady().then(async () => {
  registerCoreIpc();

  // Keep the Windows login entry and the stored setting in sync. A stored
  // "on" with no OS entry (reinstall/update) gets re-registered; an entry
  // the user enabled externally gets adopted into settings.
  if (process.platform === 'win32') {
    const actual = app.getLoginItemSettings().openAtLogin;
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

  app.on('activate', () => windows.toggle());
});

app.on('before-quit', () => {
  resources.stop();
  WindowsTray.get().destroy();
  popouts.closeAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
