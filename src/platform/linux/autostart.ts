import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

/**
 * Linux login-item support via the freedesktop.org XDG autostart spec.
 * Mirrors what `app.setLoginItemSettings` does on Windows/macOS: create or
 * remove ~/.config/autostart/whatszap.desktop.
 *
 * The Exec line covers all three run modes:
 *  - AppImage:    $APPIMAGE (set by the AppImage runtime)
 *  - installed:   the packaged binary (process.execPath)
 *  - dev:         electron binary + app directory
 */

function autostartFile(): string {
  return path.join(app.getPath('appData'), 'autostart', 'whatszap.desktop');
}

function quote(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

function execCommand(): string {
  if (process.env.APPIMAGE) return quote(process.env.APPIMAGE);
  if (app.isPackaged) return quote(process.execPath);
  return `${quote(process.execPath)} ${quote(app.getAppPath())}`;
}

export function isLinuxAutostartEnabled(): boolean {
  try {
    return fs.existsSync(autostartFile());
  } catch {
    return false;
  }
}

export function setLinuxAutostart(enabled: boolean): void {
  const file = autostartFile();
  try {
    if (!enabled) {
      fs.rmSync(file, { force: true });
      console.info('[startup] linux autostart removed');
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=WhatsZAP',
      'Comment=WhatsApp Web desktop client with isolated profiles',
      `Exec=${execCommand()} --hidden`,
      'Icon=whatszap',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
    fs.writeFileSync(file, entry, { mode: 0o644 });
    console.info(`[startup] linux autostart enabled -> ${file}`);
  } catch (err) {
    console.error('[startup] linux autostart update failed:', err);
  }
}
