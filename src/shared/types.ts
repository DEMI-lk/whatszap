export const MAX_PROFILES = 10;
export const WHATSAPP_URL = 'https://web.whatsapp.com';

export type ProfileState = 'destroyed' | 'loading' | 'active' | 'suspended';

/**
 * Chromium memory/performance profile, applied at startup (restart required):
 * 'normal' = defaults, 'low' = smaller memory budgets, 'minimal' = low +
 * software rendering (least RAM, most CPU).
 */
export type MemoryMode = 'normal' | 'low' | 'minimal';

export interface ProfileMeta {
  id: string;
  name: string;
  avatar: string | null; // absolute path to copied avatar image, null = initials
  createdAt: number;
  /** Active (keep-alive) vs Sleep. Undefined in pre-V1.2 files -> true. */
  keepAlive: boolean;
}

export interface ProfileInfo {
  id: string;
  name: string;
  /** Raw avatar reference: null (initials), "builtin:N", or a file path. */
  avatarRaw: string | null;
  avatarDataUrl: string | null;
  initials: string;
  state: ProfileState;
  unread: number;
  keepAlive: boolean;
  poppedOut: boolean;
}

export interface AppSettings {
  maxProfiles: number;
  ramLimitMB: number;
  cpuTargetPercent: number;
  backgroundMode: boolean;
  startWithWindows: boolean;
  activeProfileId: string | null;
  /** Folder scanned for latest.yml + Setup exe. Empty = userData/updates. */
  updatesDir: string;
  /** UI accent color (hex). */
  accentColor: string;
  /** Chromium memory profile; changing it needs an app restart. */
  memoryMode: MemoryMode;
}

export type UpdaterState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';

export interface UpdaterStatus {
  state: UpdaterState;
  message: string;
  version?: string;
}

export interface UpdaterInfo {
  appVersion: string;
  updatesDir: string;
  availableVersion: string | null;
  installerName: string | null;
  status: UpdaterStatus;
}

/** Alias used across main-process modules. */
export type Settings = AppSettings;

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Renderer-visible platform descriptor (window chrome decisions). */
export interface PlatformInfo {
  platform: NodeJS.Platform;
  /** Linux draws its own minimize/maximize/close buttons. */
  customWindowControls: boolean;
}


export interface ResourceSample {
  totalRamMB: number;
  cpuPercent: number;
  ramLimitMB: number;
  cpuTargetPercent: number;
  lastAction: string;
}

/** Channels invoked renderer -> main. */
export const IPC = {
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
  setBuiltinAvatar: 'profiles:set-builtin-avatar',
  avatarsList: 'avatars:list',
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
  platformInfo: 'app:platform-info',
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
} as const;

/** Channels emitted main -> renderer. */
export const IPC_EVENTS = {
  snapshot: 'event:snapshot',
  resources: 'event:resources',
  updaterStatus: 'event:updater-status',
  windowState: 'event:window-state',
} as const;
