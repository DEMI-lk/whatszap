import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UpdaterInfo, UpdaterStatus } from '../shared/types';

const IS_WINDOWS = process.platform === 'win32';

interface UpdateManifest {
  version: string;
  installerFile: string; // local path or remote URL
  sha512: string;
  source: 'local' | 'github';
}

/**
 * Update checker with two channels:
 *
 * 1. GitHub Releases (primary, automatic): fetches `latest.yml` and the NSIS
 *    installer from the repo's latest public release. Publishing a release
 *    on GitHub is the only step needed — installed apps pick it up.
 * 2. Local folder (fallback/override): `latest.yml` + Setup exe in the
 *    configurable folder (local disk or network share).
 *
 * Either way the installer's sha512 is verified against the manifest before
 * a silent NSIS install runs.
 */
export class LocalUpdater {
  status: UpdaterStatus = { state: 'idle', message: '' };
  onStatus: ((status: UpdaterStatus) => void) | null = null;

  private pending: UpdateManifest | null = null;

  constructor(
    private readonly getDir: () => string,
    private readonly exitApp: () => void,
    private readonly githubRepo: string | null = null,
  ) {}

  info(): UpdaterInfo {
    const dir = this.resolveDir();
    let availableVersion: string | null = null;
    let installerName: string | null = null;
    if (this.pending && this.status.state === 'available') {
      availableVersion = this.pending.version;
      installerName = path.basename(this.pending.installerFile);
    } else {
      try {
        const manifest = this.readLocalManifest(dir);
        if (manifest && this.isNewer(manifest.version, app.getVersion())) {
          availableVersion = manifest.version;
          installerName = path.basename(manifest.installerFile);
        }
      } catch {
        /* unreadable dir -> nothing available */
      }
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

    // Channel 1: GitHub Releases (Windows installers only — Linux/macOS builds
    // are published as AppImages/proper bundles and installed manually).
    if (this.githubRepo && IS_WINDOWS) {
      try {
        const res = await net.fetch(
          `https://github.com/${this.githubRepo}/releases/latest/download/latest.yml`,
          { signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } },
        );
        if (res.ok) {
          const manifest = this.parseManifestYaml(await res.text(), 'github');
          if (this.isNewer(manifest.version, app.getVersion())) {
            this.pending = manifest;
            this.setStatus({
              state: 'available',
              message: `Version ${manifest.version} is available.`,
              version: manifest.version,
            });
            return this.info();
          }
          this.pending = null;
          this.setStatus({ state: 'up-to-date', message: `Up to date (v${app.getVersion()}).` });
          return this.info();
        }
        console.info(`[updater] github channel returned ${res.status}; falling back to local folder`);
      } catch (err) {
        console.info(
          '[updater] github channel unreachable, falling back to local folder:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Channel 2: local folder.
    const dir = this.resolveDir();
    try {
      const manifest = this.readLocalManifest(dir);
      if (!manifest) {
        this.setStatus({
          state: 'up-to-date',
          message: IS_WINDOWS
            ? `No updates found (GitHub unreachable, no latest.yml in ${dir}).`
            : `v${app.getVersion()} — automatic updates are Windows-only; get Linux builds from GitHub Releases.`,
        });
      } else if (this.isNewer(manifest.version, app.getVersion())) {
        this.pending = manifest;
        this.setStatus({
          state: 'available',
          message: `Version ${manifest.version} is available.`,
          version: manifest.version,
        });
      } else {
        this.pending = null;
        this.setStatus({ state: 'up-to-date', message: `Up to date (v${app.getVersion()}).` });
      }
    } catch (err) {
      this.setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return this.info();
  }

  /** Downloads (GitHub) or copies (local) the installer, verifies, installs. */
  async install(): Promise<void> {
    if (!this.pending || this.status.state !== 'available') {
      this.setStatus({ state: 'error', message: 'Run "Check for updates" first.' });
      return;
    }
    this.setStatus({ state: 'installing', message: 'Preparing installer…' });

    try {
      const tmpDir = path.join(app.getPath('temp'), 'whatszap-update');
      // Start from a clean folder: otherwise every update attempt leaves its
      // Setup exe and launcher batch behind in %TEMP% forever. Best effort —
      // a still-running previous installer may hold the files open.
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* locked by a running installer — stale files stay, not fatal */
      }
      fs.mkdirSync(tmpDir, { recursive: true });

      let target: string;
      if (this.pending.source === 'github') {
        this.setStatus({ state: 'installing', message: `Downloading ${this.pending.version}…` });
        const res = await net.fetch(this.pending.installerFile, {
          signal: AbortSignal.timeout(600_000),
        });
        if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
        target = path.join(tmpDir, path.basename(this.pending.installerFile).replace(/ /g, '.'));
        fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      } else {
        target = path.join(tmpDir, path.basename(this.pending.installerFile));
        fs.copyFileSync(this.pending.installerFile, target);
      }

      const hash = crypto.createHash('sha512').update(fs.readFileSync(target)).digest('base64');
      if (hash !== this.pending.sha512) {
        throw new Error('Installer checksum mismatch — file corrupted or tampered.');
      }

      // Linux/macOS: no silent installer pipeline. Keep the verified file,
      // mark AppImages executable, and show it in the file manager so the user
      // can install/relaunch manually.
      if (!IS_WINDOWS) {
        try {
          if (target.endsWith('.AppImage')) fs.chmodSync(target, 0o755);
        } catch {
          /* chmod is best effort */
        }
        this.setStatus({
          state: 'up-to-date',
          message: `Verified v${this.pending.version}. Automatic install is Windows-only — the file was saved to ${target}.`,
        });
        try {
          shell.showItemInFolder(target);
        } catch {
          /* non-fatal */
        }
        return;
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

      // Write a tiny batch file instead of passing a complex command line
      // through cmd.exe (Node's argument escaping mangles && and redirects).
      // The batch waits (ping delay works under any stdin), then launches
      // the installer after this process has fully exited — no file locks.
      const batch = path.join(tmpDir, 'whatszap-update.cmd');
      fs.writeFileSync(
        batch,
        [
          '@echo off',
          'ping -n 4 127.0.0.1 >nul',
          `start "" "${target}" /S --force-run`,
          '',
        ].join('\r\n'),
      );
      // Node >= 18.20.2 / 20.12.2 (incl. the Node 22 runtime in Electron)
      // refuses to spawn .bat/.cmd files directly — the CVE-2024-27980
      // hardening makes spawn() throw EINVAL — so route the batch through
      // cmd.exe explicitly.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('cmd.exe', ['/d', '/s', '/c', batch], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          cwd: tmpDir,
        });
        let spawned = false;
        child.once('spawn', () => {
          spawned = true;
          child.unref();
          resolve();
        });
        // Also keeps a later 'error' from becoming an unhandled event.
        child.on('error', (err) => {
          if (spawned) console.error('[updater] installer launcher errored:', err);
          else reject(err);
        });
      });
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

  private parseManifestYaml(raw: string, source: 'local' | 'github'): UpdateManifest {
    const version = /^version:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const file = /^path:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const sha512 = /^sha512:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    if (!version || !file || !sha512) {
      throw new Error('latest.yml is malformed (missing version/path/sha512).');
    }
    let installerFile = file;
    if (source === 'github') {
      if (!this.githubRepo) throw new Error('GitHub channel not configured.');
      // GitHub renames asset spaces to dots; the manifest keeps spaces.
      const asset = file.replace(/ /g, '.');
      installerFile = `https://github.com/${this.githubRepo}/releases/latest/download/${asset}`;
    }
    return { version, installerFile, sha512, source };
  }

  private readLocalManifest(dir: string): UpdateManifest | null {
    const manifestPath = path.join(dir, 'latest.yml');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = this.parseManifestYaml(fs.readFileSync(manifestPath, 'utf-8'), 'local');
    // `path:` is relative to the folder holding latest.yml, NOT to the process
    // CWD (packaged builds run with the install dir as CWD).
    manifest.installerFile = path.join(dir, path.basename(manifest.installerFile));
    if (!fs.existsSync(manifest.installerFile)) {
      throw new Error(`Installer "${path.basename(manifest.installerFile)}" not found next to latest.yml.`);
    }
    return manifest;
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
