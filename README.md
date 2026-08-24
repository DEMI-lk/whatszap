# WhatsZAP

> ## ⚠️ Disclaimer — read before using
>
> **This is a vibe-coded app without proper testing. Use it entirely at your own risk.**
>
> - Built with AI assistance: **Ox Alpha** (opencode, free tier) in roughly **2 days** — see the [changelog](CHANGELOG.md) for details.
> - WhatsZAP is an unofficial client that simply hosts the official WhatsApp Web. It is **not affiliated with, endorsed by, or connected to WhatsApp/Meta** in any way. Use of WhatsApp Web remains subject to [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service) — automated or modified clients can, in theory, violate them and put your account at risk.
> - **Do NOT commit directly to this repo.** If you want to change or maintain the app, **fork it** and continue on your own copy. Issues and stars are welcome; direct pushes are reserved for the maintainer.

Lightweight, open-source **Electron desktop client for WhatsApp Web** with
multiple isolated, persistent profiles. Windows-first (Linux/macOS ready via a
platform abstraction layer). Inspired by Linux clients like ZapZap.

## Features (V1)

- Up to **10 profiles**, each with its own persistent Chromium session — log in
  once per profile, stay logged in across restarts.
- Vertical circular profile rail with initials or custom avatars, unread badges.
- Fast profile switching; inactive profiles are suspended (detached, muted,
  throttled), never destroyed immediately.
- Resource governor: RAM limit (default 1.5 GB) and sustained CPU target
  (default 10%). Under pressure it clears caches and destroys the *oldest
  inactive* profile's WebContents — **persistent sessions are never touched**,
  so reopening a destroyed profile restores the logged-in page without a QR scan.
- Minimal shell: top bar with Profile / Settings / Reload / DevTools / Exit.
- Settings: background mode (tray), performance limits. ("Start with Windows"
  is a disabled placeholder for V2.)
- Secure by default: sandboxed renderers, context isolation, no Node access to
  WhatsApp Web, popups open in your system browser.

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

## Architecture

```
src/
├── main/            # Electron main process
│   ├── main.ts                  # wiring & app lifecycle
│   ├── window-manager.ts        # frameless shell window + shortcuts
│   ├── profile-manager.ts       # lifecycle state machine + IPC surface
│   ├── resource-manager.ts      # RAM/CPU sampler & mitigation ladder
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
not implement the WhatsApp protocol, store credentials, or inject scripts into
the page. Treat it like a dedicated browser window per account. Use of WhatsApp
Web remains subject to WhatsApp's terms.
