import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AppSettings, ContentBounds, ProfileInfo, ResourceSample } from '../shared/types';

// Sandboxed preloads cannot require() project files, so channel names are
// duplicated here on purpose. Keep in sync with src/shared/types.ts (IPC).
const IPC = {
  getProfiles: 'profiles:get-all',
  getStateSnapshot: 'profiles:snapshot',
  selectProfile: 'profiles:select',
  createProfile: 'profiles:create',
  renameProfile: 'profiles:rename',
  deleteProfile: 'profiles:delete',
  setKeepAlive: 'profiles:set-keep-alive',
  popoutProfile: 'profiles:popout',
  popinProfile: 'profiles:popin',
  pickAvatar: 'profiles:pick-avatar',
  removeAvatar: 'profiles:remove-avatar',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getResources: 'resources:get',
  updaterInfo: 'updater:info',
  updaterCheck: 'updater:check',
  updaterInstall: 'updater:apply',
  contentBounds: 'shell:content-bounds',
  chromeVisibility: 'shell:chrome-visibility',
  reloadActive: 'actions:reload',
  toggleDevTools: 'actions:devtools',
  setViewVisible: 'webview:set-visible',
  exitApp: 'app:exit',
} as const;

const IPC_EVENTS = {
  snapshot: 'event:snapshot',
  resources: 'event:resources',
  updaterStatus: 'event:updater-status',
} as const;

const api = {
  getProfiles: (): Promise<ProfileInfo[]> => ipcRenderer.invoke(IPC.getProfiles),
  selectProfile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.selectProfile, id),
  createProfile: (name?: string): Promise<ProfileInfo | null> =>
    ipcRenderer.invoke(IPC.createProfile, name),
  renameProfile: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.renameProfile, id, name),
  deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteProfile, id),
  setKeepAlive: (id: string, keepAlive: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setKeepAlive, id, keepAlive),
  popoutProfile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.popoutProfile, id),
  popinProfile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.popinProfile, id),
  pickAvatar: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.pickAvatar, id),
  removeAvatar: (id: string): Promise<void> => ipcRenderer.invoke(IPC.removeAvatar, id),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.updateSettings, patch),

  getResources: (): Promise<ResourceSample> => ipcRenderer.invoke(IPC.getResources),

  getUpdaterInfo: (): Promise<import('../shared/types').UpdaterInfo> =>
    ipcRenderer.invoke(IPC.updaterInfo),
  checkUpdates: (): Promise<import('../shared/types').UpdaterInfo> =>
    ipcRenderer.invoke(IPC.updaterCheck),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updaterInstall),
  onUpdaterStatus: (cb: (status: import('../shared/types').UpdaterStatus) => void): (() => void) =>
    subscribe(IPC_EVENTS.updaterStatus, cb),

  sendContentBounds: (bounds: ContentBounds): void => {
    void ipcRenderer.invoke(IPC.contentBounds, bounds);
  },

  reloadActive: (): Promise<void> => ipcRenderer.invoke(IPC.reloadActive),
  toggleDevTools: (): Promise<void> => ipcRenderer.invoke(IPC.toggleDevTools),
  setViewVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setViewVisible, visible),

  exitApp: (): Promise<void> => ipcRenderer.invoke(IPC.exitApp),

  onSnapshot: (cb: (profiles: ProfileInfo[]) => void): (() => void) =>
    subscribe(IPC_EVENTS.snapshot, cb),
  onResources: (cb: (sample: ResourceSample) => void): (() => void) =>
    subscribe(IPC_EVENTS.resources, cb),
  onChromeVisibility: (cb: (visible: boolean) => void): (() => void) =>
    subscribe(IPC.chromeVisibility, cb),
  onShortcut: (name: 'reload' | 'devtools' | 'profile-next' | 'profile-prev', cb: () => void): (() => void) =>
    subscribe(`shortcut:${name}`, cb),
};

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

export type WhatsZapApi = typeof api;

contextBridge.exposeInMainWorld('whatszap', api);
