import { app } from 'electron';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UpdaterInfo, UpdaterStatus } from '../shared/types';

interface UpdateManifest {
  version: string;
  installerFile: string;
  sha512: string;
}

/**
 * Local-folder updater: no external service required.
 *
 * Drop the artifacts of a newer build — `latest.yml` plus the NSIS
 * `WhatsZAP Setup <version>.exe` — into the updates folder (local disk or a
 * network share, configurable in Settings). The app compares versions,
 * verifies the installer's sha512 against the manifest, then runs the NSIS
 * silent install and restarts.
 */
export class LocalUpdater {
  status: UpdaterStatus = { state: 'idle', message: '' };
  onStatus: ((status: UpdaterStatus) => void) | null = null;

  private pending: UpdateManifest | null = null;

  constructor(
    private readonly getDir: () => string,
    private readonly exitApp: () => void,
  ) {}

  info(): UpdaterInfo {
    const dir = this.resolveDir();
    let availableVersion: string | null = null;
    let installerName: string | null = null;
    try {
      const manifest = this.readManifest(dir);
      if (manifest && this.isNewer(manifest.version, app.getVersion())) {
        availableVersion = manifest.version;
        installerName = manifest.installerFile;
      }
    } catch {
      /* unreadable dir -> nothing available */
    }
    return {
      appVersion: app.getVersion(),
      updatesDir: dir,
      availableVersion,
      installerName,
      status: this.status,
    };
  }

  async check(): Promise<UpdaterInfo> {
    this.setStatus({ state: 'checking', message: 'Checking for updates…' });
    const dir = this.resolveDir();
    try {
      const manifest = this.readManifest(dir);
      if (!manifest) {
        this.setStatus({ state: 'error', message: `No latest.yml found in ${dir}` });
      } else if (this.isNewer(manifest.version, app.getVersion())) {
        this.pending = manifest;
        this.setStatus({
          state: 'available',
          message: `Version ${manifest.version} is available.`,
          version: manifest.version,
        });
      } else {
        this.pending = null;
        this.setStatus({
          state: 'up-to-date',
          message: `Up to date (v${app.getVersion()}).`,
        });
      }
    } catch (err) {
      this.setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return this.info();
  }

  /** Copies the installer to temp, verifies its hash, runs silent setup. */
  async install(): Promise<void> {
    if (!this.pending || this.status.state !== 'available') {
      this.setStatus({ state: 'error', message: 'Run "Check for updates" first.' });
      return;
    }
    const dir = this.resolveDir();
    const source = path.join(dir, path.basename(this.pending.installerFile));
    this.setStatus({ state: 'installing', message: 'Preparing installer…' });

    try {
      const tmpDir = path.join(app.getPath('temp'), 'whatszap-update');
      fs.mkdirSync(tmpDir, { recursive: true });
      const target = path.join(tmpDir, path.basename(source));
      fs.copyFileSync(source, target);

      const hash = crypto.createHash('sha512').update(fs.readFileSync(target)).digest('base64');
      if (hash !== this.pending.sha512) {
        throw new Error('Installer checksum mismatch — file corrupted or tampered.');
      }

      // Remove Mark-of-the-Web (Zone.Identifier) so SmartScreen doesn't block
      // installers that were downloaded via a browser.
      try {
        fs.unlinkSync(`${target}:Zone.Identifier`);
      } catch {
        /* no MotW present — fine */
      }

      this.setStatus({ state: 'installing', message: `Installing ${this.pending.version}…` });
      console.info(`[updater] launching silent install of ${this.pending.version}`);

      // `ping` delay (NOT `timeout`, which fails under redirected stdin) —
      // the detached wrapper waits for this process to fully exit before
      // running the installer, avoiding file-lock races.
      const script = `ping -n 4 127.0.0.1 >nul && "${target}" /S --force-run`;
      const child = spawn('cmd.exe', [
        '/d', '/s', '/c', script,
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      setTimeout(() => this.exitApp(), 500).unref?.();
    } catch (err) {
      this.setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private setStatus(status: UpdaterStatus): void {
    this.status = status;
    console.info(`[updater] ${status.state}: ${status.message}`);
    this.onStatus?.(status);
  }

  private resolveDir(): string {
    const configured = this.getDir().trim();
    return configured || path.join(app.getPath('userData'), 'updates');
  }

  private readManifest(dir: string): UpdateManifest | null {
    const manifestPath = path.join(dir, 'latest.yml');
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf-8');

    const version = /^version:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const file = /^path:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const sha512 = /^sha512:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    if (!version || !file || !sha512) {
      throw new Error('latest.yml is malformed (missing version/path/sha512).');
    }
    const installerFile = path.join(dir, path.basename(file));
    if (!fs.existsSync(installerFile)) {
      throw new Error(`Installer "${path.basename(file)}" not found next to latest.yml.`);
    }
    return { version, installerFile, sha512 };
  }

  /** Numeric semver-style comparison: true if a > b. */
  private isNewer(a: string, b: string): boolean {
    const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff > 0;
    }
    return false;
  }
}
