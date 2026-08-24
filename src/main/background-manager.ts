/**
 * V1 background mode (minimal by design):
 *
 *   backgroundMode = false -> closing the window quits the app entirely.
 *   backgroundMode = true  -> closing hides to a small tray; WhatsApp renderers
 *                             stay suspended/destroyed per resource policy.
 *
 * NOTE: no service-worker notification daemon is assumed; once Electron fully
 * terminates, notifications are gone (see spec §12).
 */
import { app } from 'electron';

export class BackgroundManager {
  private quittingRequested = false;

  constructor(
    private readonly isEnabled: () => boolean,
    private readonly hooks: {
      hideToBackground: () => void;
      restoreFromBackground: () => void;
      exitApp: () => void;
    },
  ) {}

  /** Returns true if close should be intercepted (hide instead of quit). */
  shouldInterceptClose(): boolean {
    return this.isEnabled() && !this.quittingRequested;
  }

  handleClose(): void {
    if (this.shouldInterceptClose()) this.hooks.hideToBackground();
    else this.hooks.exitApp();
  }

  /** Enter tray/background mode without a close event (e.g. --hidden launch). */
  enterBackground(): void {
    this.hooks.hideToBackground();
  }

  requestQuit(): void {
    this.quittingRequested = true;
    this.hooks.exitApp();
  }
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function ensureSingleInstance(onSecondLaunch: () => void): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', onSecondLaunch);
  return true;
}
