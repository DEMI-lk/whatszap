// Cross-platform Electron launcher (npm start / npm run dev).
//
// Windows/macOS: spawns Electron directly.
// Linux: Chromium needs either the SUID sandbox helper (chrome-sandbox owned by
// root, mode 4755) or unprivileged user namespaces that the OS permits. On
// Ubuntu 24.04+ AppArmor typically blocks the namespace path, so a plain
// `electron .` aborts with:
//
//   FATAL:setuid_sandbox_host.cc(169)] The SUID sandbox helper binary was
//   found, but is not configured correctly...
//
// When we detect that broken state we relaunch with --no-sandbox so the app
// still starts, and print the one-time sudo commands that restore full
// renderer sandboxing. The command-line flag must be set at process spawn;
// appending it inside main.ts is too late (the crash happens before the
// app's JS ever runs).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// When required from plain Node, the electron package exports the path to the
// electron binary (not the Electron API module).
const electronBinary = require('electron');

const appDir = path.join(__dirname, '..');

function hasProperSuidSandbox(distDir) {
  const helper = path.join(distDir, 'chrome-sandbox');
  let stat;
  try {
    stat = fs.statSync(helper);
  } catch {
    // Helper missing entirely: Chromium falls back to namespaces or reports
    // its own clear error either way, so don't interfere.
    return true;
  }
  return stat.uid === 0 && (stat.mode & 0o4755) === 0o4755;
}

function main() {
  const extraArgs = process.argv.slice(2);
  const args = ['.', ...extraArgs];

  if (process.platform === 'linux' && !hasProperSuidSandbox(path.dirname(electronBinary))) {
    console.warn('[launch] The Chromium SUID sandbox is not configured for this Electron install.');
    console.warn('[launch] Launching WITHOUT sandbox as a fallback (renderers lose their security\n' +
      '[launch] guard). To restore full sandboxing, run this ONCE from the repo root:\n');
    console.warn(`  sudo chown root:root "${path.join('node_modules', 'electron', 'dist', 'chrome-sandbox')}"`);
    console.warn(`  sudo chmod 4755 "${path.join('node_modules', 'electron', 'dist', 'chrome-sandbox')}"\n`);
    console.warn('[launch] (Re-run npm install / upgrading Electron resets it; also see the Ubuntu\n' +
      '[launch] AppArmor user-namespace restriction for a system-wide alternative.)');
    args.unshift('--no-sandbox');
  }

  const child = spawn(electronBinary, args, {
    cwd: appDir,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('error', (err) => {
    console.error(`[launch] Failed to start Electron (${electronBinary}):`, err);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main();
