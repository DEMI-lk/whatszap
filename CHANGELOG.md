# Changelog

All notable changes to WhatsZAP are documented here.
The app version lives in `package.json`; the installed build reports it in
Settings → Updates and in the ⋮ menu.

## Unreleased

### Fixed
- **Self-update never installed (`spawn EINVAL`).** The delayed installer
  launcher is now started through `cmd.exe /d /s /c`, because Node ≥ 18.20.2
  (all Electron 37 builds) refuses to `spawn()` a `.cmd` file directly.
- **Local update folder ignored its own manifest location.** `latest.yml`'s
  relative `path:` is now resolved against the folder that contains the
  manifest instead of the process working directory, so "Check for updates"
  finds (and installs) an installer that sits next to `latest.yml` no matter
  where the app was started from.
- **"Remove avatar" / "Reset to initials" only worked after a restart.** The
  live profile record is patched together with the saved one, so the rail
  updates immediately.
- **Wrong profile ringed when a pop-out existed.** Profiles that are "active"
  only because they live in their own window no longer steal the highlight, and
  clicking such a circle reaches the main process again (it focuses the pop-out).
- **Launching WhatsZAP a second time hid the running window.** A second launch
  (and macOS "activate") now restores and focuses the existing window instead
  of toggling it away; the tray keeps its toggle behaviour.
- **Update staging folder was never cleaned.** `%TEMP%\whatszap-update` is now
  emptied before each attempt, so old Setup exe's and launcher batches no longer
  accumulate (a locked file from a still-running installer is tolerated).
- **Second instance exited abruptly.** It now quits through Electron
  (`app.quit()`, plus a short `app.exit(0)` safety net) and skips building any
  UI instead of killing the process with `process.exit(0)`.
- Removed an unreferenced 605 KB image from `assets/`, split two imports that
  shared a line, and pointed the `build.publish` URL at the real release
  channel (it used to be `https://updates.invalid/whatszap`).
- **Deleting the active profile no longer leaves a blank window.** The
  replacement is now any other profile (preferring one that is already warm)
  instead of only "suspended" ones, which never matched Sleep profiles.
- **Closing a pop-out window hands the profile back to the main window.**
  The shared view is detached from the window while it is still alive, and if
  the main window is still empty the same (warm) page is re-attached — no
  reload, no blank content area. A profile closed mid-load no longer gets stuck
  in the "loading" state either.
- **The RAM/CPU chip updates from a push event** instead of waiting for its
  15-second poll (the subscription existed, main never emitted it).
- **A cold profile loads WhatsApp Web once, not twice** — the view manager is
  now the single owner of the first navigation and the load path waits for it.
- **Settings, window geometry and profile names coming from the UI are
  validated in the main process** (numbers clamped, colours must be hex, enums
  checked, `activeProfileId` not writable from the renderer) so a buggy or
  hostile page can't corrupt `settings.json` or the native view geometry.
- **Profile metadata writes can no longer fail loudly or diverge from disk**
  when `%APPDATA%` is locked or full, and two profile stores no longer share
  one in-memory list (a store whose `profiles.json` was missing/corrupt used to
  inherit another store's entries).
- Removed dead code (`isWindows`, `poppedIds`, unused `WebviewManager`
  accessors, the superseded `shared/renderer-api.ts`) and wired the Linux/macOS
  placeholder layers into `getPlatform()` so they are no longer unreferenced.
- Custom-avatar images are cached as data URLs (invalidated whenever the avatar
  changes) instead of being re-read and re-encoded on every UI snapshot.

### Added
- **Settings → Performance → Memory mode.** `low` (default) trims Chromium's
  compositor/V8 memory budgets, `minimal` additionally renders in software for
  the lowest RAM use, `normal` restores Chromium defaults. Applied at startup —
  the app asks for a restart when changed.
- **Nirmala UI** is enforced for message text (`.selectable-text`) so Sinhala
  and other Indic scripts render with correct shaping.

### Changed
- **RAM limit default lowered from 1536 MB to 1024 MB** so the resource
  governor clears inactive caches / puts sleep profiles away sooner. Existing
  installs still holding the old default are migrated once; a value you picked
  yourself is left alone.

## 1.2.5 — 2026-08-25

### Test release
- Live test of the GitHub Releases update channel: installed 1.2.4 apps
  should discover, download, verify, and silently install this release via
  Settings → Updates → "Check for updates". No functional changes.

## 1.2.4 — 2026-08-25

### Added
- **GitHub Releases update channel.** "Check for updates" now fetches the
  latest public release from GitHub automatically — publishing a release
  there is the only step; no more manual copying into the updates folder
  (which remains as an offline/override fallback).

## 1.2.3 — 2026-08-24

### Added
- **Ctrl+1…9 / Ctrl+0** jumps straight to profiles 1–10.

### Fixed
- Window could only be dragged by a tiny strip of the title bar — the entire
  top bar is now draggable.
- Silent updates never ran: the installer's `timeout` delay fails under
  redirected input, so the launch chain aborted before starting setup
  (now uses a stdin-proof `ping` delay, plus Mark-of-the-Web is stripped
  from the copied installer so SmartScreen can't block it).

## 1.2.2 — 2026-08-24

### Added
- **Profile avatars.** Right-click a profile circle → "Change avatar…" opens a
  picker with the bundled built-in set (70 illustrated avatars, fully
  offline), a custom image upload, and "Reset to initials".
- Custom images are stored verbatim inside the profile's own data folder
  (never cropped — the full image renders in the circle), so they survive
  moving/deleting the original file. Built-ins are stored as `builtin:N`
  references. Both persist across restarts.
- **Accent color palette** (Settings → Appearance): 8 accent colors; the
  focus ring glow, presence dots, spinner, checkboxes, and primary buttons
  all follow. Persisted.
- UI polish: slim dark scrollbars app-wide, themed modal buttons, checkbox
  layout fixes.

### Removed
- Double-click-to-rename on profile circles (annoying; rename lives in the
  right-click menu).

### Changed
- All circle indicators (focus ring, Active/Sleep presence dot, unread
  badge, pop-out badge) layer above avatar images unchanged.

## 1.2.1 — 2026-08-24

### Fixed
- **Duplicate notifications for a single message.** Two native toasts used to
  appear: WhatsApp Web's own page notification, plus a WhatsZAP aggregate
  toast from the unread-count watcher. The page's `Notification` API is now
  replaced by a sandboxed capture shim inside the WhatsApp view — its
  sender/content data feeds **one** unified WhatsZAP toast, and the session
  denies the `notifications` permission so no other path (including
  ServiceWorker notifications) can reach the OS.
- Unified toast format: **profile name** (title) / **sender's name** /
  **message content**. Clicking it focuses the profile's window (pop-out or
  main shell) and switches to it.

### Changed
- WhatsApp views now run with `contextIsolation: false` (still sandboxed,
  zero Node access) so the notification shim can patch the page world.

## 1.2.0 — 2026-08-24

### Added
- **Per-profile Active / Sleep states** — right-click any profile circle to
  toggle "Keep alive". Sleep profiles are fully destroyed when not focused
  (near-zero RAM, no background notifications — by design); waking reloads
  the persisted session without a QR scan. Presence dots on circles: green =
  live, gray = sleeping.
- **Multi-window pop-out** — pop a profile into its own OS window
  (context menu → "Pop out window"). Popped profiles are implicitly
  keep-alive, show a ⧉ badge, and clicking their circle focuses the window.
  Closing the window restores the profile's previous Active/Sleep choice.
- **Start with Windows** — real sign-in launch via `setLoginItemSettings`;
  starts hidden in the tray (`--hidden`). Self-heals after reinstall/update
  and adopts externally-enabled entries.
- **Local-folder updater** — Settings → Updates: point at a folder
  (local disk or network share) containing a newer build's `latest.yml` +
  NSIS Setup exe; the app verifies sha512, silently installs, and restarts.
  No external update server required.
- App version shown in Settings → Updates and in the ⋮ menu; this changelog.

### Changed
- Resource governor never destroys keep-alive profiles — Active/Sleep is a
  user decision, not a monitor decision.
- New profiles default to **Sleep** (the first profile defaults Active);
  pre-1.2 profiles migrate to keep-alive to preserve prior behavior.

## 1.1.0 — 2026-08-24

### Fixed
- Blank content area after reopening the app while background mode was
  enabled: the suspended view is now re-attached through a single
  window-show → `ensureActiveAttached()` → `select()` path shared with
  normal profile switching.
- Stale green highlight on a profile that was no longer active; the ring now
  reflects the real focused profile.
- RAM/CPU behavior was invisible: the governor now logs band crossings
  (80% of RAM limit), every action (destroy / cache clear / reliability
  floor), and exposes its last action via the RAM/CPU chip tooltip.
- Settings now show live background-mode status text.

## 1.0.0 — 2026-08-23

### Added
- Initial release.
- Electron shell around WhatsApp Web (Chrome UA + client-hint branding so
  web.whatsapp.com serves the full experience).
- Up to 10 profiles with isolated persistent sessions (`persist:` partitions)
  and vertical circular switcher with initials/avatars and unread badges.
- Profile lifecycle: ACTIVE / SUSPENDED / DESTROYED / LOADING with
  attach-then-detach switching; destroyed profiles restore logged-in.
- Resource governor: 15 s sampling of all Chromium processes, 1.5 GB RAM
  limit and 10% sustained CPU target (configurable), mitigation ladder.
- Frameless shell (top bar + rail), settings dialog, secure sandboxed
  preload bridge, permission allowlist, navigation restricted to WhatsApp
  domains, popups to system browser.
- Background mode (tray) and single-instance lock.
- Windows packaging (NSIS + portable).
