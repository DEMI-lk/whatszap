# WhatsZAP

> ## ⚠️ Disclaimer — read before using
>
> **This is a vibe-coded app with proper testing. Use it entirely at your own risk.**
>
> - Built with AI assistance: **Ox Alpha** (opencode, free tier) in roughly **2 days** — see the [changelog](CHANGELOG.md) for details.
> - WhatsZAP is an unofficial client that simply hosts the official WhatsApp Web. It is **not affiliated with, endorsed by, or connected to WhatsApp/Meta** in any way. Use of WhatsApp Web remains subject to [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service) — automated or modified clients can, in theory, violate them and put your account at risk.
> - **Do NOT commit directly to this repo.** If you want to change or maintain the app, **fork it** and continue on your own copy. Issues and stars are welcome; direct pushes are reserved for the maintainer.

> ### 🔒 Unsigned builds — Windows may warn or block installation
>
> WhatsZAP's installers are **not code-signed** (signing certificates cost real money for a free project). Consequences on Windows:
>
> - **SmartScreen** shows *"Windows protected your PC"* on first run — click **More info → Run anyway**.
> - **Smart App Control** (Windows 11, if enabled) blocks unsigned apps entirely — the app will not install while it is on.
> - Some antivirus products may flag the unsigned installer or the self-update flow.
>
> The app itself is open source — you can audit the code and build it yourself with `npm install && npm run dist`. Code signing is planned once the project can justify the certificate cost; the build pipeline is already signing-ready.

Lightweight, open-source **Electron desktop client for WhatsApp Web** with
multiple isolated, persistent profiles. Windows-first (Linux/macOS ready via a
platform abstraction layer). Inspired by Linux clients like ZapZap.

## Features (V1)

- Up to **10 profiles**, each with its own persistent Chromium session — log in
  once per profile, stay logged in across restarts.
- Vertical circular profile rail with initials or custom avatars, unread badges.
- Fast profile switching; inactive profiles are suspended (detached, muted,
  throttled), never destroyed immediately.
- Pop-out mode: move any profile into its own OS window — the page is
  reparented, never reloaded, and closing that window hands the profile back to
  the main window.
- Resource governor: RAM limit (default 1 GB) and sustained CPU target
  (default 10%). Under pressure it clears caches and destroys the *oldest
  inactive* profile's WebContents — **persistent sessions are never touched**,
  so reopening a destroyed profile restores the logged-in page without a QR scan.
- Memory modes (`normal` / `low` / `minimal`): `low` is the default; `minimal`
  also disables the GPU process for the smallest footprint (takes effect after
  a restart).
- Minimal shell: top bar with Profile / Settings / Reload / DevTools / Exit.
- Settings: background mode (tray), Start with Windows, RAM/CPU limits, memory
  mode, updates folder.
- Sinhala chat text is pinned to the **Nirmala UI** font so it renders correctly
  on systems whose default UI font lacks Sinhala glyphs.
- Secure by default: sandboxed renderers with no Node access to page content, a
  context-isolated shell UI, and only a narrow message/notification shim exposed
  to WhatsApp Web; popups open in your system browser.

## Updates

- Installed apps check **GitHub Releases** automatically: the release must carry
  `latest.yml` and the NSIS `Setup` installer, and must **not** be marked as a
  pre-release (the app resolves `releases/latest/download`).
- A local or network folder containing `latest.yml` + installer can be set in
  Settings as a fallback/override channel.
- The installer is sha512-verified against the manifest before a silent install;
  the download is staged in `%TEMP%\whatszap-update\` before it runs.

## Development

```bash
npm install
npm start        # build + launch
npm run dev      # alias of start
npm run watch    # tsc --watch
npm run typecheck
npm run dist     # package for Windows (NSIS + portable) into release/
```

Requires Node 18+ and npm.

Or simply double-click **`run.bat`** — it installs dependencies if they're
missing, builds, and launches the app (extra arguments are passed through, e.g.
`run.bat --hidden`).

See [BUG-REPORT.md](BUG-REPORT.md) for the current code review: findings,
severity, fix status and how each fix was verified.

### Releasing (maintainer)

```bash
npm run typecheck && npm run dist
```

Upload **both** `release/WhatsZAP Setup <version>.exe` and `release/latest.yml`
as assets of a GitHub release tagged for that version, and make sure the release
is **not** marked as a pre-release — installed apps resolve
`releases/latest/download`, so a missing `latest.yml` (or a pre-release) silently
breaks auto-update.

## Architecture

```
src/
├── main/            # Electron main process
│   ├── main.ts                  # wiring & app lifecycle
│   ├── window-manager.ts        # frameless shell window + shortcuts
│   ├── profile-manager.ts       # lifecycle state machine + IPC surface
│   ├── popout-manager.ts        # pop-out windows (view reparenting)
│   ├── resource-manager.ts      # RAM/CPU sampler & mitigation ladder
│   ├── memory-tuning.ts         # memory-mode Chromium switches
│   ├── ipc-validation.ts        # renderer IPC trust boundary
│   ├── avatar-cache.ts          # bounded avatar data-URL cache
│   ├── updater.ts               # GitHub Releases / local-folder self-update
│   ├── background-manager.ts    # tray/background close behavior
│   └── settings-store.ts        # config/settings.json
├── profiles/
│   ├── profile-store.ts         # config/profiles.json metadata
│   └── profile-session.ts       # ACTIVE/SUSPENDED/DESTROYED/LOADING record
├── webview/
│   ├── webview-manager.ts       # WebContentsView attach/detach/destroy
│   └── session-manager.ts       # persist:<id> partitions + permission policy
├── notifications/               # NotificationManager + providers/
├── platform/                    # windows/ linux/ macos/ abstraction layer
├── renderer/                    # shell UI (top bar + profile rail)
├── preload/                     # secure contextBridge API
└── shared/                      # types & IPC channel contracts
```

### Where is my data?

Under `%APPDATA%/WhatsZAP/`:

```
config/profiles.json     profile metadata (name/avatar)
config/settings.json     app settings
profiles/profile-NN/     marker dir (+ avatar copies)
Partitions/profile-NN/   Chromium persistent session data (cookies, login)
```

Chromium controls partition storage layout (`userData/Partitions/<partition>`),
which is why browser data lives there rather than inside `profiles/`. Isolation
and persistence are guaranteed by `session.fromPartition('persist:<profile-id>')`.

### Lifecycle

`DESTROYED → LOADING → ACTIVE ⇄ SUSPENDED`

- Switching attaches the incoming view first (no blank flash), then suspends
  the previous one.
- Suspension = detached + muted + background throttled (kept warm).
- Destruction closes only the WebContents; the on-disk session survives, so
  reselecting the profile reloads WhatsApp Web already authenticated.

## Privacy & security notes

WhatsZAP only hosts the official WhatsApp Web in an embedded browser. It does
not implement the WhatsApp protocol or store credentials; a small preload
forwards message notifications, reports unread counts and pins the Sinhala font
— it does not send or read your messages. Treat it like a dedicated browser
window per account. Use of WhatsApp Web remains subject to WhatsApp's terms.
