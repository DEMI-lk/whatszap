# Changelog

All notable changes to WhatsZAP are documented here.
The app version lives in `package.json`; the installed build reports it in
Settings → Updates and in the ⋮ menu.

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
