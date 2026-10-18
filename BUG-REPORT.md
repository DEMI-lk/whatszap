# WhatsZAP — Bug & Workflow Review Report

**Project:** WhatsZAP v1.2.5 (`com.whatszap.app`) — Electron 37 / TypeScript WhatsApp Web shell with multi-profile support
**Review date:** 2026-10-18
**Scope:** All source under `src/`, `scripts/`, build config (`package.json`, `tsconfig.json`), README/CHANGELOG claims vs. implementation, and the observable runtime workflows: **app start-up, profile lifecycle (create/select/suspend/destroy/delete), pop-out multi-window, update install, notifications, background/tray, resource governor, keyboard shortcuts, avatars**.
**Method:** Full read of every source file + static reasoning on the Electron APIs involved; `npm run build` and `tsc --noEmit` executed; the updater's installer-launch was reproduced against Node to confirm a crash-class defect. No `.github/` CI workflows exist in this repo, so "workflow" here means the application's runtime workflows.

---

## 1. Executive summary

| Severity | Count | Highlights |
|---|---|---|
| 🔴 **Critical** | 2 *(1 fixed)* | ~~Self-update can never install (`.cmd` spawn `EINVAL`)~~ → **fixed & verified in this tree**; deleting a profile leaves its WhatsApp session on disk and the next profile silently reuses it (open) |
| 🟠 **High** | 4 *(2 fixed)* | ~~Local-folder update channel resolves paths against the CWD~~ → **fixed & verified**; a crashed renderer permanently blanks the app until you switch profiles; ~~"Reset to initials" does nothing until restart~~ → **fixed & verified**; keyboard shortcuts never reach the shell |
| 🟡 **Medium** | 8 *(6 fixed, 1 half)* | ~~Wrong active-profile highlight with pop-outs~~, ~~dead `resources` push event~~, ~~blank shell when deleting the active profile~~, ~~second launch hides the window~~, ~~fragile view reparenting~~ → **fixed & verified**; avatar re-reads on every snapshot → **cached**; background-mode bypass on `--hidden` and notification-shim trust still open |
| ⚪ **Low / hygiene** | 15 *(10 fixed)* | ~~Missing validation~~, ~~unguarded store writes~~, ~~shared store state~~, ~~temp-file leaks~~, ~~double navigation~~, ~~unconsumed pop-out states~~, ~~dead code~~, ~~unused 605 KB asset~~, ~~bogus `publish` URL~~, ~~abrupt second-instance exit~~ → **fixed**; session eviction on delete (L-3), pop-out UX notes (L-7/L-8), session permissions (L-13) and tests/CI (L-12) still open |

**Overall build health:** `tsc --noEmit` passes clean, `npm run build` completes correctly (renderer `app.js` is emitted as a plain non-module script, assets are copied). The code is tidy and well-commented; the issues below are concentrated in Electron-API edge cases and in the two newest features (self-updater, pop-outs).

**Verdict:** closer to release-safe, but not there yet. Both batches of quick fixes are **fixed and verified in this working tree** — the broken self-update (**C-1**), the local update channel's path handling (**H-1**), avatar reset (**H-3**), wrong active-profile highlight (**M-1**), second launch hiding the window (**M-5**), the delete-active blank shell (**M-4**), pop-out return (**M-6**), the dead resource push (**M-3**), the double first navigation (**L-5**), the IPC trust boundary (**L-1**), store robustness (**L-2**, **L-15**) and the hygiene batch (**L-4**, **L-9**, **L-10…L-12**, **L-14**). What remains is the genuinely non-trivial set: profile deletion still leaves the WhatsApp session on disk (**C-2**, the one that actually matters for privacy), renderer-crash recovery (**H-2**), shortcuts while WhatsApp is focused (**H-4**), the `--hidden`/background-mode product decision (**M-7**), notification-shim trust (**M-8**), the rail DOM rebuild half of **M-2**, session eviction (**L-3**) and tests/CI (**L-12**). See §1.5 and the finding sections for the evidence.

---

## 1.5 Feature & workflow status — what works, what doesn't

Legend: ✅ works (code-verified) · 🟠 works with caveats / partially broken · ❌ broken · ⚪ cannot be verified in this environment. Finding IDs refer to sections 2–5.

### ✅ What works

| Feature / workflow | Evidence |
|---|---|
| **Build & typecheck** | `tsc --noEmit` → exit 0; `npm run build` (tsc + copy-assets + gen-icon) completes; `dist/renderer/app.js` correctly emitted as a plain script; preloads/main emitted to the expected paths |
| **Shell UI** (frameless top bar, profile rail, dropdown menus, modals, settings, accent palette) | `index.html`/`styles.css`/`app.ts` are consistent; every DOM id referenced by `app.ts` exists in the markup; overlay logic hides the native view while menus/modals are open |
| **Profile create / rename** | Limit enforced (`MAX_PROFILES`, + button disables at the limit); first profile defaults Active, later ones Sleep; rename patches both store and in-memory session |
| **Profile switching (ACTIVE ⇄ SUSPENDED ⇄ DESTROYED)** | Serialised `selectQueue`, attach-then-detach (no blank flash), mute on suspend, persistent partitions survive destroys |
| **Persistent login across restarts** | One `persist:<id>` partition per profile; Chromium controls storage location, sessions are never wiped by destroy/suspend |
| **Keep-alive vs Sleep** | Toggling works both directions (wake destroyed → suspended; sleep a warm profile → destroy); pre-1.2 profiles migrate to keep-alive; resource governor exempts keep-alive profiles |
| **Unread badges** | `page-title-updated` → `"(3) WhatsApp"` regex → per-profile counter → throttled snapshot (250 ms) |
| **Notifications (single unified toast)** | Shim preload replaces `window.Notification` in the page world, forwards sender/content over IPC; main formats **profile name / sender / message**, suppresses when the profile is focused, opens/focuses the right window on click; session denies the `notifications` permission as a second lock |
| **Background mode (tray)** | Close is intercepted when enabled, renderers are suspended/destroyed per policy, tray Show → `ensureActiveAttached()` reattaches the last active profile; Exit bypasses interception via `exitHook` |
| **Start with Windows** | `setLoginItemSettings` + `--hidden`; startup self-heal re-registers a missing entry and adopts an externally enabled one |
| **Single-instance lock** | Second process exits; the `second-instance` event is wired |
| **Resource governor** | 15 s sampling of `app.getAppMetrics()`, 80 % RAM band logging, sustained-CPU (8-sample) gate, cache-clear → destroy-oldest-inactive ladder, reliability floor (never the last inactive), last action surfaced in the chip tooltip |
| **Security posture** | Sandboxed renderers, `nodeIntegration: false`, allowlisted permission handler, cross-origin-aware main-frame navigation filter, pop-ups denied and opened in the system browser, Chrome UA + `sec-ch-ua` rewrite so WhatsApp treats it as Chrome |
| **GitHub update *check*** | `releases/latest/download/latest.yml` fetch, manifest parse, semver compare, "update available" status — the discovery half of the update workflow is sound |
| **Signatures/config of the installer** | NSIS + portable targets, asar packaging, correct `files` globs, icon/tray/preload paths resolve both in dev and packaged builds |
| **Avatar sub-features** | 70 bundled avatars discovered and cached as data URLs; custom images copied verbatim into the profile folder (survive the source file being moved); built-in grid renders |

### ✅ Fixed during this review

| Issue | Fix applied | Verification |
|---|---|---|
| **C-1 — self-update could never install** (`spawn EINVAL`) | `src/main/updater.ts` now launches the delay-batch through `cmd.exe /d /s /c <batch>` (with `cwd` pinned to the temp folder) instead of spawning the `.cmd` directly; the flow awaits the `spawn` event so a launch failure is reported as an updater error, and an `error` listener prevents an unhandled event from crashing main | `tsc --noEmit` → clean; `npm run build` emits the fixed call into `dist/main/updater.js`; **live run of the compiled updater inside real Electron 37.10.3 / Node 22.21.1** drove the entire workflow against a fake `latest.yml` + installer — the control shows the old direct `.cmd` spawn still **throws `EINVAL`** in that runtime, while the fixed path parses the manifest → verifies sha512 → writes the launcher → `cmd.exe` runs it → 3 s delay → `start` launches the installer (marker written, `/S --force-run` received) → `exitApp()` requested; a tampered installer is still refused with `checksum mismatch` and never launched. **8/8 checks passed.** Installing a real signed release end-to-end still requires a packaged build + published release |
| **H-1 — local update channel resolved the installer against the process CWD** | `readLocalManifest()` now rewrites `manifest.installerFile` to `path.join(dir, path.basename(file))` before the existence check and the later copy, so the folder holding `latest.yml` always wins — no `chdir` workaround needed | Same live run with the process CWD deliberately moved to `%TEMP%`: `check()` reports `available 99.9.9` and resolves `FakeWhatsZAP-Setup-99.9.9.cmd` from the updates folder (the old code reported *"not found next to latest.yml"* here). **Passed** |
| **H-3 — "Remove avatar" / "Reset to initials" only took effect after a restart** | `IPC.removeAvatar` now also patches the live session (`rec.meta.avatar = null`) before the store write + snapshot, exactly like `rename()` / `setBuiltinAvatar()` | **End-to-end run against the real app over CDP:** created a throwaway profile, applied `builtin:1` (snapshot showed a data URL), removed it → snapshot `avatarDataUrl` is `null`, then deleted the profile again. **4/4 checks passed** (the probe profile was removed, workspace left with `profile-01` only) |
| **M-1 — wrong profile ringed when a pop-out exists** | `activeId` is derived with `p.state === 'active' && !p.poppedOut` in both the snapshot handler and the boot path; the rail click guard is now simply `if (!focused)` so clicking a popped circle always reaches main | **Harness on the compiled renderer bundle** (real `index.html`/`app.js`, stubbed bridge): pop-out listed second and first, plus "only a pop-out is active" — exactly the shell profile gets the ring, list order irrelevant, and with no shell-active profile there is no ring and the loading hint stays visible. **5/5 checks passed** |
| **M-5 — launching the app again hid the running window** | New `WindowManager.showAndFocus()` (restore if minimised → `show()` → `focus()`), wired to `second-instance` and macOS `activate`; `toggle()` is now reachable from the tray only | **Live two-instance run:** primary window visible → second launch → primary window still visible *and* foreground, same window/PID. **Passed** |
| **L-4, L-14, L-10…L-12 — housekeeping batch** | The update temp folder is wiped (best-effort `rmSync`, tolerates a locked previous installer) before each install; the second instance now `app.quit()`s with a 1 s `app.exit(0)` safety net instead of `process.exit(0)`, and skips all UI setup (`whenReady` guard); concatenated imports split; the unreferenced 605 KB `Gemini_Generated_Image_…jpg` deleted; `build.publish` URL changed from `https://updates.invalid/whatszap` to the real channel `https://github.com/DEMI-lk/whatszap/releases/latest/download` (still the manual-upload `generic` provider, so electron-builder never auto-publishes) | Updater harness: a planted `stale-setup-from-previous-run.exe` was gone after `install()` while the new launcher was written; two-instance run: second PID exited in **0.3 s** (well inside the 1 s fallback, i.e. `app.quit()` did the job). `tsc --noEmit` + `npm run build` green; `package.json` re-parsed |
| **Group B — IPC trust boundary, pop-out return, store robustness** | `src/main/ipc-validation.ts` (settings/bounds/name sanitising) wired into `updateSettings`, `contentBounds`, `rename`/`create`; `AvatarCache` for custom avatars; `ResourceManager.onSample` → `IPC_EVENTS.resources`; `replacementFor()` fallback when the active profile is deleted; pop-out `close` detaches the shared view and the return path re-attaches the *shell's* old profile; `loading` handled on return; `isLoadInFlight()` makes the first navigation single-owner; `ProfileStore` saves are guarded and no longer share state; dead symbols removed and the Linux/macOS layers actually used | `groupb-units` (L-1 sanitisers + cache) **17/17**; Electron harness (L-2 unwritable path, L-5 loadURL counting incl. control) **8/8**; live CDP run against the real app (L-1 hostile IPC payloads, M-3 push, M-4 delete-active recovery, M-6 pop-out return) **10/10**; `tsc --noEmit` + `npm run build` green |

### ❌ What is not working

| Broken workflow | Symptom | Finding |
|---|---|---|
| **Delete profile** | Metadata + `profiles/<id>` folder are removed, but the WhatsApp session partition (`Partitions/<id>`) is not; recycled profile ids make the next profile launch **logged in as the deleted account**. Contradicts the "and its WhatsApp session data?" dialog | **C-2** |
| **Local-folder update detection** | ✅ **fixed** — `latest.yml`'s relative `path:` is now resolved against the manifest's own folder, so detection and copying work from any CWD | **H-1** |
| **Renderer-crash recovery** | After a WhatsApp renderer crash the content area stays blank; the ring still shows Active and clicking the profile does nothing (both the rail guard and `selectInner` short-circuit). Only switching to another profile and back recovers | **H-2** |
| **Reset to initials / Remove avatar** | ✅ **fixed** — the live session record is cleared (`rec.meta.avatar = null`) alongside the store, so the rail updates immediately | **H-3** |
| **Keyboard shortcuts** | Ctrl+Tab, Ctrl+1…9/0, Ctrl+R/F5, Ctrl+Shift+I never fire while WhatsApp has focus because the handler lives on the shell's `webContents` only. Only the equivalents in the menus work | **H-4** |
| **`event:resources` push** | ✅ **fixed** — main now pushes each sample to the shell (the existing subscription drives the chip; the 15 s poll remains as a fallback) | **M-3** |
| **Active-profile highlight with pop-outs** | ✅ **fixed** — `poppedOut` profiles are excluded when the renderer decides which profile is ringed, and the rail click guard no longer swallows clicks on popped circles | **M-1** |

### 🟠 What works but is degraded / fragile

| Area | Caveat | Finding |
|---|---|---|
| **Pop-out windows** | ✅ **fixed** — the shared view is detached from the window while it is still alive, and closing a pop-out of the shell's profile restores the profile (warm view, no reload) | **M-6**, **L-6** |
| **Performance of the snapshot pipeline** | Custom-avatar data URLs are now cached + invalidated on change (the disk I/O is gone); the rail still rebuilds its DOM on each unread change (up to 4×/s during active chat) | **M-2** |
| **Deleting the active profile** | ✅ **fixed** — any other profile is eligible as the replacement (cheapest first), so the shell no longer goes blank | **M-4** |
| **Second launch / macOS activate** | ✅ **fixed** — `showAndFocus()` restores/focuses the running window; `toggle()` is only used by the tray | **M-5** |
| **`--hidden` (Start with Windows)** | Enters tray/background mode even when *Enable background mode* is unchecked | **M-7** |
| **Notification shim** | Requires `contextIsolation: false` in the WhatsApp view and reports `permission = 'granted'`, so page script can fabricate branded toasts | **M-8** |
| **WhatsApp calls** | `media` is granted; `display-capture` is denied → screen sharing in calls will not work (scope decision, worth documenting) | **L-13** |
| **Update housekeeping** | ✅ **fixed** — the temp installer folder is wiped (best-effort) before each new attempt, so Setup exe’s no longer accumulate | **L-4** |
| **Robustness of persistence** | ✅ **fixed** — store writes are guarded (a locked disk can no longer throw out of an IPC handler or desync the in-memory list), stores no longer share state, and unvalidated renderer payloads are sanitised in main | **L-1**, **L-2**, **L-15** |
| **First view load** | ✅ **fixed** — `ensureView()` is the single owner of the first navigation; `loadWhatsApp()` waits for it instead of issuing a second load | **L-5** |
| **Repo hygiene** | The unused 605 KB asset is **deleted**, the `publish` URL **fixed** and dead code **removed**; the missing tests/CI remains | **L-9**, **L-12** |

### ⚪ Not verified in this environment

- **Real WhatsApp Web traffic:** the app and its shell renderer were launched live for the fixes in §1.5, but a *logged-in* WhatsApp Web session (QR scan, message flow, long-running notifications) and its native toasts were not exercised.
- **Packaging (`npm run dist`)** and the produced NSIS/portable installers were not executed; only the updater's launch/verify/cleanup chain was driven with a stand-in installer.
- **A real end-to-end self-update install:** still requires an old packaged build plus a published release (GitHub channel) or an installer dropped next to `latest.yml` (local channel).
- Items marked 🟠/❌ that depend on runtime timing (pop-out reparenting, renderer-crash recovery, shortcut focus) remain high-confidence from the Electron API contracts but should be confirmed with the manual test plan in section 7.

---

## 2. Critical findings

### C-1 🔴 Self-update is completely broken — `spawn()` of a `.cmd` throws `EINVAL`

> **Status: ✅ FIXED in this working tree** (`src/main/updater.ts`, applied 2026-10-18). The analysis below is kept for context; verification evidence is in §1.5.

- **Workflow:** Settings → Updates → *Install & restart* (both GitHub and local channels — every update path goes through this code).
- **File:** `src/main/updater.ts:182-187`

```ts
const child = spawn(batch, [], {          // <-- batch = "...\whatszap-update.cmd"
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
```

- **Root cause:** Since the April-2024 Node.js security release (CVE-2024-27980), `child_process.spawn()` **refuses to launch `.bat`/`.cmd` files without `shell: true`** and throws `EINVAL`. This is present in Node ≥ 18.20.2 / 20.12.2 / 21.7.3 **and all Node 22.x**, which is exactly what Electron 37 bundles.
- **Evidence (reproduced in this review):** running the exact call on the review machine:

```
node -e "spawn(path/to/t.cmd, [], {detached:true, stdio:'ignore', windowsHide:true})"
→ THREW SYNC: EINVAL spawn EINVAL
```

The fix shapes were also tested and work: `spawn('cmd.exe', ['/d','/s','/c', batch], …)` → `SPAWN OK`; `spawn(batch, [], { shell: true, … })` → `SPAWN OK`.
- **Live evidence in the real runtime (2026-10-18):** the *compiled* `dist/main/updater.js` was loaded into an Electron 37.10.3 main process (Node 22.21.1) with a fake `latest.yml` + `.cmd` "installer". In that same process the old call shape threw `EINVAL`, while the fixed `install()` completed the whole chain — manifest parsed, sha512 verified, launcher written to `%TEMP%\whatszap-update\whatszap-update.cmd`, `cmd.exe` spawned, 3 s `ping` delay, `start "" "…FakeWhatsZAP-Setup…cmd" /S --force-run` executed (the fake installer recorded its arguments), `exitApp()` requested. A manifest pointing at a tampered payload was still rejected with *"Installer checksum mismatch"* and nothing was launched: **8/8 checks passed**.
- **User-visible symptom:** Download/checksum steps succeed, then the status flips to **"error: spawn EINVAL"** (caught by the `try/catch` at `updater.ts:189`) and nothing installs. This is the *same class of failure* the changelog already fixed twice (1.2.3 "Silent updates never ran", 1.2.5 "live test"), so the regression is easy to miss.
- **Fix (applied):** the batch is now launched through the shell explicitly, and the install flow waits for the process to actually start:

```ts
await new Promise<void>((resolve, reject) => {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', batch], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: tmpDir,
  });
  let spawned = false;
  child.once('spawn', () => { spawned = true; child.unref(); resolve(); });
  child.on('error', (err) => { if (spawned) console.error(…); else reject(err); });
});
setTimeout(() => this.exitApp(), 500).unref?.();
```

Awaiting the `spawn` event means a launch failure is surfaced as an updater error instead of being silently swallowed, and the persistent `error` listener prevents an unhandled `'error'` event from crashing the main process. (`spawn(batch, [], { shell: true, … })` also works; the `cmd.exe` form avoids DEP0190 warnings and quoting traps.)

---

### C-2 🔴 "Delete profile" does not delete the WhatsApp session, and profile IDs are recycled — the new profile logs into the deleted account

- **Workflow:** Right-click circle → *Delete profile…* → confirm dialog: *"Delete "X" and its WhatsApp session data? This cannot be undone."*; then *New profile*.
- **Files:** `src/main/profile-manager.ts:211-237` (delete), `src/profiles/profile-store.ts:78-85` (id allocation), `src/webview/session-manager.ts:34-39` (partition ↔ id), `README.md:81-92` (documented layout).

```ts
// deleteProfile()
fs.rmSync(path.join(this.profilesRoot, id), { recursive: true, force: true });  // only the MARKER dir
// ... the Chromium data lives elsewhere:
```

```ts
// session-manager.ts
const partition = `persist:${profileId}`;   // persistent cookies/IndexedDB keyed by profile id
```

```ts
// profile-store.ts
nextProfileId() { for (let i = 1; i <= 999; i++) { const id = `profile-${String(i).padStart(2,'0')}`;
  if (!existing.has(id)) return id; } }   // smallest free id → recycles deleted ids
```

- **Root cause:** Deleting a profile removes `config/profiles.json` metadata and the `profiles/<id>` marker folder, but **never the Chromium partition** under `%APPDATA%/WhatsZAP/Partitions/<id>/` (the actual cookies, IndexedDB, service workers, WhatsApp login). Because the next created profile takes the *smallest free id*, a new profile reuses the deleted profile's partition name.
- **Impact:**
  1. **Privacy/security:** the deleted account's session data stays on disk forever (contradicting the confirmation dialog and the app's own privacy section).
  2. **Account mix-up:** delete `profile-01`, create a new profile → it is immediately **logged in as the deleted account**, showing its chats to whoever created the new profile.
- **Fix (do both):**
  - Wipe the partition on delete: after `webviews.destroy(id)`, `await session.fromPartition('persist:'+id).clearStorageData(); await …clearCache();` and schedule removal of `userData/Partitions/<id>` (Chromium may hold file locks, so delete on next boot if the rm fails — keep a small "orphaned partitions" sweep at startup). Also drop the `Session` from `SessionManager.sessions`.
  - Make ids monotonic (e.g. persist a `nextId` counter or use `Date.now()`-based ids) so a recycled id can never inherit an old partition.

---

## 3. High findings

### H-1 🟠 Local update channel checks/copies the installer **relative to the process CWD**

- **File:** `src/main/updater.ts:225-233` (`readLocalManifest`) and `148-149` (`install`, local branch)
- **Cause:** electron-builder's `latest.yml` carries a *relative* `path:` (e.g. `WhatsZAP Setup 1.2.5.exe`). The code tests `fs.existsSync(manifest.installerFile)` and later `fs.copyFileSync(manifest.installerFile, target)` **without joining the manifest's directory** — so both resolve against the process working directory (the install dir for a packaged app), not the folder the user configured in *Updates folder*.
- **Symptom:** *Check for updates* fails with `Installer "WhatsZAP Setup 1.2.5.exe" not found next to latest.yml` even though the file is right next to it; or, worse, it copies an unrelated same-named file found in the CWD.
- **Fix:** store the directory on the manifest, or resolve at use time:

```ts
installerFile: path.join(dir, file),   // local source
```

- **Status: ✅ FIXED** — `readLocalManifest()` now rebases the manifest's relative `path:` onto the folder that holds `latest.yml` (and reports the *basename* in errors, so messages stay readable):

```ts
// src/main/updater.ts — readLocalManifest()
manifest.installerFile = path.join(dir, path.basename(manifest.installerFile));
if (!fs.existsSync(manifest.installerFile)) {
  throw new Error(`Installer "${path.basename(manifest.installerFile)}" not found next to latest.yml.`);
}
```

- **Verified:** in the live updater run (Electron 37.10.3), the process CWD was deliberately moved to `%TEMP%` before `check()`; the local channel still found the update (`available 99.9.9`, installer `FakeWhatsZAP-Setup-99.9.9.cmd` resolved from the updates folder) and `install()` copied and launched it. The same harness previously needed `process.chdir(updatesDir)` to get past this bug.

### H-2 🟠 A crashed WhatsApp renderer blanks the app; clicking the profile does nothing

- **Files:** `src/webview/webview-manager.ts:74-82`, `src/main/profile-manager.ts:145`, `src/renderer/app.ts:120-125`
- **Cause:** on `render-process-gone` the view is deleted and detached, but nothing tells the state machine. `ProfileSession.state` stays `active` and `ProfileManager.activeId` still points at it. `selectInner()` then returns early:

```ts
if (this.activeId === id && target.state === 'active') return;   // dead session, no view
```
Worse, the rail's click guard (`renderer/app.ts:122`) sees `focused === true` and never even calls `selectProfile`.
- **Symptom:** WhatsApp crashes (OOM/GPU crash is routine for web.whatsapp.com) → permanently blank content area; the ring still shows the profile as active. Recovery requires selecting a *different* profile and then back (or restarting).
- **Fix:** `render-process-gone` should notify `ProfileManager` (new event on `WebviewManager`): transition the session to `destroyed`, clear `activeId`/`attachedId`, `emitSnapshot()` and optionally auto-reload once (`ensureView` + `loadWhatsApp`).

### H-3 🟠 "Remove avatar" / "Reset to initials" never takes effect until restart

- **File:** `src/main/profile-manager.ts:75-78`

```ts
ipcMain.handle(IPC.removeAvatar, (_e, id: string) => {
  this.store.update(id, { avatar: null });   // writes the store…
  this.emitSnapshot();                       // …but snapshots read rec.meta
});
```

- **Cause:** `ProfileStore.update()` **replaces** the stored object (`profile-store.ts:64-70`), while `toInfo()` (`profile-manager.ts:593-605`) serialises `rec.meta`. `rename()`, `setCustomAvatar()` and `setBuiltinAvatar()` all explicitly patch `rec.meta`; the remove-avatar handler is the one path that forgets. The rail keeps rendering `avatarRaw`/`avatarDataUrl` from the stale `rec.meta.avatar`.
- **Symptom:** the avatar reset button (and *Remove avatar* menu item) looks like it does nothing; after an app restart the avatar is gone (store was updated).
- **Fix:** mirror the other handlers:

```ts
const rec = this.sessionsMap.get(id);
if (!rec) return;
rec.meta.avatar = null;
this.store.update(id, { avatar: null });
this.emitSnapshot();
```

- **Status: ✅ FIXED** — the handler now patches the live session and the store in one place (no early return, so a missing session record no longer blocks the persisted change):

```ts
// src/main/profile-manager.ts
ipcMain.handle(IPC.removeAvatar, (_e, id: string) => {
  // Both the store AND the live session (the snapshot reads rec.meta).
  const rec = this.sessionsMap.get(id);
  if (rec) rec.meta.avatar = null;
  this.store.update(id, { avatar: null });
  this.emitSnapshot();
});
```

- **Verified end-to-end against the running app over CDP:** a throwaway profile was created, `builtin:1` applied (snapshot carried a data URL), then `removeAvatar` was invoked → the next `getProfiles()` snapshot reported `avatarDataUrl: null` for the same session (no restart), and the probe profile was deleted again afterwards. 4/4 checks passed. Note the store really is a *different object* (`ProfileStore.update()` spreads into a new record), which is why the store-only write could never fix the live snapshot.

### H-4 🟠 Keyboard shortcuts are registered on the wrong WebContents — Ctrl+R/F5/Ctrl+Shift+I/Ctrl+Tab/Ctrl+1-9/0 don't fire

- **File:** `src/main/window-manager.ts:65-79` (`this.win.webContents.on('before-input-event', …)`)
- **Cause:** `before-input-event` is a **per-WebContents** event. Right after every profile attach, `selectInner()` calls `webviews.focusActive()` (`profile-manager.ts:175`), so keyboard focus lives in the WhatsApp **WebContentsView**, which has no handler. Key events therefore never reach the shell's handler that forwards `shortcut:reload`, `shortcut:devtools`, `shortcut:profile-next/prev/index`.
- **Symptom:** the documented 1.2.3 feature "Ctrl+1…9 / Ctrl+0 jumps straight to profiles" and the Ctrl+Tab cycling do not work while you are actually using WhatsApp. (The ⋮ menu items still work, which hides the defect.)
- **Fix:** register the same `before-input-event` handler on each WhatsApp view's `webContents` inside `WebviewManager.ensureView()` (route to the same callbacks), or use `Menu` accelerators / `globalShortcut` (globalShortcut steals keys system-wide — prefer per-view binding).

---

## 4. Medium findings

### M-1 🟡 Wrong profile highlighted when a pop-out exists (and its circle can become unclickable)

- **Files:** `src/main/profile-manager.ts:437-439` (pop-out marks the session `active`), `src/renderer/app.ts:445-446`

```ts
const current = list.find((p) => p.state === 'active');   // picks the FIRST active profile
activeId = current ? current.id : null;
```

- Since a popped-out profile also has `state === 'active'`, and profiles are returned in `createdAt` order, popping out an early-created profile (then switching the shell to a later profile) makes the renderer bind `activeId` to the **popped** profile: the shell-active profile loses its green ring, and clicking the popped circle is a silent no-op (the click guard at `app.ts:122` sees `focused`… false but `p.id === activeId && p.state === 'active'` true → no IPC), so you can't focus the pop-out window from the rail either.
- **Fix:** `list.find(p => p.state === 'active' && !p.poppedOut)`, and/or expose a dedicated `activeInShell` flag from main instead of overloading `state`.
- **Status: ✅ FIXED** — the renderer excludes pop-outs in both places where it derives the ringed profile (snapshot handler and boot), and the click guard was reduced to the `focused` flag it already computes:

```ts
// src/renderer/app.ts
const current = list.find((p) => p.state === 'active' && !p.poppedOut);   // also on boot (getProfiles)
...
el.addEventListener('click', () => { if (!focused) api.selectProfile(p.id); });
```

- **Verified:** harness against the compiled renderer bundle (real `index.html` + `app.js`, stubbed bridge, snapshots pushed through the real `onSnapshot` path). Cases: shell profile listed first → ring on index 0; pop-out listed **first** → ring still on the shell profile (index 1); only a pop-out `active` → **no** ring and the loading hint stays visible; the sleeping profile keeps its own marker and pop-out circles are never marked sleeping/destroyed. 5/5 passed. The two order-sensitive cases fail on the pre-fix predicate.

### M-2 🟡 Snapshot pipeline re-reads avatars from disk and rebuilds the whole rail 4×/second

- **Files:** `src/main/profile-manager.ts:593-650` + `675-685`, `src/renderer/app.ts:70-133` + `441-450`
- `toInfo()` runs for **every** profile on every snapshot and calls `readAvatarDataUrl()` — a synchronous `readFileSync` + base64 encode of the full custom avatar (users pick multi-MB phone photos; the README brags they are stored "verbatim, never cropped"). There is a cache for built-in avatars (`builtinAvatarCache`) but **none for custom ones**.
- The renderer then rebuilds the entire rail DOM (new `<button>`/`<img>` elements per circle) on every snapshot; snapshots fire on every unread-count change, throttled to 250 ms — i.e. up to 4 full rebuilds + full avatar re-encodes per second during an active chat.
- **Fix:** cache custom-avatar data URLs keyed by path (+ mtime/size, invalidated on avatar change); update rail nodes in place (badge text, classes) instead of `textContent = ''` rebuilds.
- **Status: 🟠 half FIXED** — the expensive half is gone: a new `AvatarCache` (`src/main/avatar-cache.ts`) keeps custom-avatar data URLs in a bounded (32-entry, LRU) map, and every avatar-mutating path invalidates it (`setCustomAvatar` — including the reused `avatar.<ext>` file name, `setBuiltinAvatar`, `removeAvatar`, `deleteProfile`). `resolveAvatar()` is now the single reader. Verified by unit tests on the compiled cache (loader runs once, invalidate re-reads, `null` cached, eviction + LRU order) plus a live end-to-end avatar set/remove over CDP.
- **Still open (the other half):** the renderer still rebuilds the whole rail DOM per snapshot; with the avatars cached the cost is now just DOM churn, not disk I/O.

### M-3 🟡 `event:resources` is never emitted — the push listener in preload/renderer is dead code

- **Files:** `src/shared/types.ts:107`, `src/preload/preload.ts:85-86`, `src/renderer/app.ts:451-454`; the main side (`src/main/resource-manager.ts`) only registers `ipcMain.handle(IPC.getResources)` and never sends `IPC_EVENTS.resources`.
- Consequence: `api.onResources(...)` is never called; the RAM/CPU chip is kept fresh only by the renderer's 15 s polling `setInterval` (`app.ts:489-495`) — the "event-driven" architecture the spec asks for isn't actually wired.
- **Fix:** emit the sample from `ResourceManager.sample()` (throttled), or delete the event and keep polling intentionally.
- **Status: ✅ FIXED (emit)** — `ResourceManager` grew an `onSample` hook that fires after every sample, and `main.ts` forwards it to the shell window as `IPC_EVENTS.resources`; the renderer's existing subscription now drives the chip (the 15 s poll stays as a fallback).
- **Verified live over CDP:** a listener registered through the app's own bridge received a pushed sample (`{"totalRamMB":1075,…}`) within one 15 s cycle — no polling call involved.

### M-4 🟡 Deleting the active profile can leave the shell blank

- **File:** `src/main/profile-manager.ts:221-226`
- The replacement search only considers **suspended** sessions (`suspendedOrder()`). With the post-1.2 defaults (every profile after the first defaults to **Sleep**, i.e. state `destroyed` after first switch), deleting the active profile of a two-profile setup leaves `activeId = null`, no selection, and a blank content area even though another (destroyed) profile exists.
- **Fix:** if no suspended candidate exists, `select()` the most recently used non-active profile (destroyed profiles reload fine), or `create()` a fresh profile when none remain.
- **Status: ✅ FIXED** — a `replacementFor()` helper considers **every** other profile and ranks them cheapest-first (suspended → live keep-alive → destroyed), with pop-out profiles last because selecting one only focuses its window. Pop-out bookkeeping for the deleted profile is cleared at the same time.
- **Verified live over CDP:** probe `profile-02` created and made active → the user's Sleep profile-01 was parked as `destroyed` (the exact state the old search could not handle) → `profile-02` deleted → profile-01 came back as `active` within seconds (`[profiles] select profile-01 (from state: destroyed)` in the app log). Pre-fix this ended with `activeId = null` and a blank content area.

### M-5 🟡 Launching the app a second time hides the running window

- **Files:** `src/main/main.ts:16-20`, `src/main/window-manager.ts:84-91`

```ts
if (!ensureSingleInstance(() => { windows.toggle(); })) …
```

`toggle()` hides a visible window. Electron's guidance for `second-instance` is to **restore + focus** the existing window. Symptom: double-clicking the desktop/taskbar shortcut while WhatsZAP is open makes the window disappear. Same problem on macOS `activate` (`main.ts:184`).
- **Fix:** add `showAndFocus()` (restore if minimized, `show()`, `focus()`) and use it for second-instance/activate; keep `toggle()` only for the tray's Show item (or make the tray click explicit).
- **Status: ✅ FIXED** — `WindowManager.showAndFocus()` added and wired to both `second-instance` and macOS `activate`; the tray keeps using `toggle()`:

```ts
// src/main/main.ts
const isPrimaryInstance = ensureSingleInstance(() => { windows.showAndFocus(); });
...
app.on('activate', () => windows.showAndFocus());
```

- **Verified live:** with the shell window visible, launching `electron .` a second time left the primary window **visible and foreground** (same PID/handle; the second process exited by itself), where the old code path would have hidden it.

### M-6 🟡 Pop-out return path never detaches the view from the closed window

- **Files:** `src/main/popout-manager.ts:70-75`, `src/webview/webview-manager.ts:111-133`/`150-168`
- When a pop-out window closes, the `'closed'` handler runs `returnHandler` but the `WebContentsView` was never `removeChildView`-ed from the destroyed window (the manager cannot do it after `closed`; nothing removes it before `close()` either). The next `attach()` adds the view to the main window relying on Electron clearing the old parent during window destruction. Chromium's `View::AddChildViewAt` performs `CheckViewBeforeAdding` (parent must be null); if that invariant is ever broken (older/newer Electron, a future path that pops out a view twice), this is a crash-class hazard rather than a graceful failure.
- **Fix:** in `PopoutManager.close()`/the `close` event, call `win.contentView.removeChildView(view)` before the window is destroyed (or destroy the view on return and let the profile reload — the session is persistent anyway).
- Also: the returned profile leaves `settings.activeProfileId` as `null` (`profile-manager.ts:442`), so the shell stays empty after closing a pop-out of the previously active profile until the user clicks a circle.
- **Status: ✅ FIXED** — two changes: (a) `PopoutManager` removes the shared view from the window's content tree in the window's `close` event (while the window is still alive) and unhooks its resize listener, so the view is never parented to a dying window; (b) `ProfileManager` remembers profiles that were **the shell's active one** when popped out (`poppedFromShell`) and, if the shell is still empty when the window closes, re-attaches that same warm view and restores the selection — no reload, no blank area. The `loading` state is now handled on this path too (L-6).
- **Verified live over CDP:** popped out the active profile-01 (`shellWhilePopped=empty`) → closed the pop-out → profile-01 back as `active`, pop-out flag cleared, app log shows `[popout] profile-01 returned to the shell window` followed by a single `[webview] attach profile-01` (no reload, no second navigation).

### M-7 🟡 `--hidden` launch forces tray/background mode even when background mode is disabled

- **File:** `src/main/main.ts:148` + `173-177`
- `Start with Windows` launches with `--hidden`; `bootstrap()` then unconditionally calls `background.enterBackground()` → `suspendAll()` + `window.hide()` + tray. So even with *Enable background mode* unchecked, the login launch runs in the tray, contradicting the setting's own hint ("Inactive — closing the window exits WhatsZAP"). Either honor `settings.backgroundMode` for the `--hidden` path or treat `--hidden` as implying background mode and reflect that in the UI.

### M-8 🟡 Notification shim weakens isolation and trusts the page

- **Files:** `src/webview/webview-manager.ts:46-58` (`contextIsolation: false`), `src/preload/whatsapp-preload.ts:16-48`, `src/main/profile-manager.ts:497-523`
- To patch the page's `window.Notification`, the WhatsApp view runs with `contextIsolation: false` (documented trade-off), and the shim reports `permission === 'granted'` and forwards any title/body the page constructs. Any injected/compromised page script can therefore fabricate unlimited WhatsZAP-branded "message" toasts (rate-limited to 1/s by the burst guard) and read a fake permission state.
- **Fix (keeps the feature):** restore `contextIsolation: true` and inject the shim into the page world via `webContents.executeJavaScript()`/`webFrame.executeJavaScript` on `did-finish-load` (the standard pattern for notification interception), keeping `sandbox: true` and the preload in an isolated world.

---

## 5. Low / hygiene findings

| # | Finding | Where | Note |
|---|---|---|---|
| L-1 | Renderer IPC payloads are unvalidated in main (`updateSettings`, `contentBounds`, avatar ids beyond `setBuiltinAvatar`) | `src/main/main.ts:109-113`, `profile-manager.ts:86` | Renderer clamps limits, but main stores whatever it receives (`ramLimitMB: -1`, giant bounds). **Fixed:** new `src/main/ipc-validation.ts` is the trust boundary — settings keys are whitelisted (`activeProfileId` is *not* renderer-writable), numbers clamped, colours must be hex, enums checked, bounds rejected unless all four values are finite and in range, names trimmed/capped. **17/17 unit checks + 5/5 live checks** (hostile payload left settings.json untouched apart from the clamps). |
| L-2 | `ProfileStore.save()` has no error handling (unlike `SettingsStore`) | `profile-store.ts:31-37` | A locked/full disk throws out of an IPC handler; in-memory cache then diverges from disk. **Fixed:** the write is wrapped, the in-memory list is authoritative (a failed write no longer throws and the next successful save rewrites the full list). **Verified in a real Electron process** against an unwritable path (`EEXIST` logged, no throw, list still consistent). |
| L-3 | `SessionManager.sessions` map is never evicted on profile delete | `session-manager.ts:15` | Combined with C-2 the Session object (and partition) outlives the profile. |
| L-4 | Update temp folder never cleaned; old Setup exe’s accumulate | `updater.ts:135-136, 172` | `%TEMP%/whatszap-update/*` grows with every update attempt. **Fixed:** wiped best-effort before each install (a locked installer is tolerated); harness proved a planted stale file is gone after `install()`. |
| L-5 | Double navigation on first view creation | `webview-manager.ts:86-88` + `profile-manager.ts:553-555` | `ensureView()` starts a load; `loadWhatsApp()` immediately starts another because `getURL()` is still `''` (navigation not committed). Harmless but wasteful and can resolve the load promise early. **Fixed:** `WebviewManager` tracks the views whose initial navigation it started (a `WeakSet` — no leaks) and exposes `isLoadInFlight()`; `loadWhatsApp()` now waits for an in-flight load instead of restarting the page, and a failed main-frame navigation clears the flag so retries still work. **Verified in a real Electron process** by counting `loadURL` calls: `ensureView()` = 1 call, `loadWhatsApp()` right after = still 1 (control without the guard = 2). |
| L-6 | `handlePopoutReturn` ignores non-`active` states | `profile-manager.ts:454-462` | Closing a pop-out while the profile is still `loading` leaves the session in `loading` (self-heals on next select). **Fixed:** `loading` is handled like `active` (→ `suspended` when keep-alive, → `destroyed` + view teardown when Sleep). The state is only reachable through narrow races, so this is defensive; the transition table allows both edges. |
| L-7 | Popping out a `loading` profile is refused with a console note only | `profile-manager.ts:417-420` | User gets no feedback in the UI. |
| L-8 | `maxProfiles()` maps a stored `0` to 10; setting not user-editable | `profile-manager.ts:126-128` | `0` likely means "unset", but the fallback is silent. |
| L-9 | Dead code / unused symbols | `platform/linux/index.ts`, `platform/macos/index.ts`, `shared/renderer-api.ts`, `background-manager.ts:46-48` (`isWindows`), `popout-manager.ts:28-30` (`poppedIds`), `PopoutEntry.onResize` field (stored, never read), `WebviewManager.hasView/getView/getBounds/allIds` | Cosmetic; `noUnusedLocals` doesn’t flag exported members, so it stays hidden. **Fixed:** `isWindows`, `poppedIds`, `hasView`, `getView`, `getBounds`, `allIds` and the superseded `shared/renderer-api.ts` removed; `onResize` is now *used* (the pop-out close path unhooks it); the Linux/macOS placeholder layers are now actually constructed by `getPlatform()` instead of being dead exports. |
| L-10 | Two imports concatenated on one line | `src/main/main.ts:5` | Formatting only. **Fixed.** |
| L-11 | Unreferenced 605 KB asset in the repo | `assets/Gemini_Generated_Image_gjp04gjp04gjp04g.jpg` | Not in `build.files`, never referenced by code; repo noise. **Fixed:** file deleted (`git rm`). |
| L-12 | No tests, no CI; `build.publish` pointed at `https://updates.invalid/whatszap` | `package.json:29-32`, repo root | The README/CHANGELOG describe a "build pipeline"; there is no `.github/` workflow and no test script (**still open**). **Partly fixed:** the publish URL now points at the real channel `https://github.com/DEMI-lk/whatszap/releases/latest/download` — still the `generic` provider, so electron-builder keeps generating `latest.yml`/`app-update.yml` but never auto-publishes in CI. |
| L-13 | Session permissions: `media` auto-granted, `display-capture` denied; only main-frame navigation is origin-filtered | `session-manager.ts:72-86` | Screen sharing in WhatsApp calls will not work (documented scope choice); sub-frames may load arbitrary origins (minor hardening gap if WhatsApp is ever XSS’d). |
| L-14 | `ensureSingleInstance` + `process.exit(0)` on the second instance | `main.ts:16-20` | `app.quit()` already fired; `process.exit` is abrupt (skips async cleanup). **Fixed:** the second instance only calls `app.quit()` (+ a 1 s `app.exit(0)` safety net) and skips all UI setup via a `whenReady` guard; measured **0.3 s** to exit in a live two-instance run. |
| L-15 | `ProfileStore.load()` shared one module-level `EMPTY.profiles` array between stores **(found while testing L-2)** | `profile-store.ts:9,24,27` | `{ ...EMPTY }` copies the *reference* to the array, so a store whose `profiles.json` is missing/corrupt started with whatever another `ProfileStore` instance (or an earlier failed load) had pushed into that shared array — e.g. two stores in one process can see each other's profiles, and a corrupt file resurrects stale entries. **Fixed:** `load()` always returns a fresh `{ profiles: [] }`. Caught by the L-2 harness (a second store persisted an entry from the first store's failed write); re-verified afterwards. |

---

## 6. What is *correct* (verified positive)

- **Build & types:** `npm run typecheck` and `npm run build` both succeed; `dist/renderer/app.js` is emitted as a plain script (no CJS wrapper) as intended by the ambient `api.d.ts` design; assets land in `dist/assets/**`.
- **Profile lifecycle core:** `transition()` enforces a sane state machine; `selectQueue` serialises selections; attach-then-detach avoids blank flashes; persistent partitions keep logins across destroys; the resource governor never destroys keep-alive profiles and keeps a reliability floor (`inactiveCount() > 1`).
- **Security posture (mostly):** sandboxed renderers, no Node in the shell or WhatsApp view, context-bridged preload with an explicit API surface, `setWindowOpenHandler` denies pop-ups and defers to the system browser, HTTP headers are rewritten to a plain-Chrome identity, notification **permission** is denied at the session level as a second lock against ServiceWorker toasts.
- **Background/tray + single instance:** close interception, tray Show/Exit, `exitHook` bypass for explicit Exit, and `--hidden` login-item self-healing are all wired coherently.
- **Avatars:** built-ins are referenced by id (`builtin:N`) with a main-process cache; custom files are copied into the profile folder so they survive the source file being moved.

---

## 6.5 Memory footprint — measured, and the new memory mode

WhatsZAP's own overhead is small; the number in the in-app RAM chip is the **sum of every process's working set**, which double-counts shared memory (DLLs, font/image caches) and therefore reads higher than the real cost. Measured on the review machine (Electron 37.10.3, one logged-in profile, 5-6 processes, settled after ~75 s):

| Process | Working set | Private (Task-Manager-style) |
|---|---|---|
| WhatsApp Web page renderer | ~370-415 MB | ~270-320 MB |
| GPU process | ~190-290 MB | ~110-200 MB |
| Browser/main process | ~108-120 MB | ~37-48 MB |
| WhatsApp service-worker renderer | ~75-111 MB | ~16-42 MB |
| Shell (app UI) renderer | ~75-111 MB | ~16-42 MB |
| Network service | ~55-58 MB | ~10-11 MB |
| **Total** | **~880-1070 MB** | **~470-640 MB** |

So "over 900 MB" is accurate for the working-set sum, but roughly half of it is shared or double-counted, and WhatsApp Web's own page plus the Chromium baseline dominate. Flag-level experiments on the same build:

| Configuration | Total working set | Private | Notes |
|---|---|---|---|
| Chromium defaults | 880-970 MB | ~470-500 MB | |
| low-end device mode + capped V8 heap + no spare renderer/bfcache/out-of-process audio | ~930 MB | ~503 MB | inside run-to-run noise with one profile; the heap cap mainly helps heavy accounts |
| the above **+ `--disable-gpu`** (software rendering) | ~825 MB | ~389 MB | GPU process 212 MB → 86 MB; costs CPU on scrolling/animations and disables WebGL |

Implemented as **Settings → Performance → Memory mode** (`low` = default, `minimal` = software rendering, `normal` = Chromium defaults), applied by `src/main/memory-tuning.ts` before `app.whenReady()`; changing it needs a restart. Note that footprint scales roughly linearly with the number of **Active (keep-alive)** profiles — each one keeps a full WhatsApp Web renderer alive, which is why new profiles default to Sleep and the governor (default **1024 MB** since this review, was 1536 MB) only destroys sleep profiles.

---

## 7. Suggested priority order & quick patches

1. `updater.ts:182` — `spawn('cmd.exe', ['/d','/s','/c', batch], {…})` **(one line, unblocks all updates)** — ✅ **done**
2. `updater.ts:229,149` — `path.join(dir, file)` for local manifests — ✅ **done**
3. `main.ts:75-78` — set `rec.meta.avatar = null` in the remove-avatar handler — ✅ **done**
4. `renderer/app.ts:445` — `list.find(p => p.state === 'active' && !p.poppedOut)` (+ boot path) — ✅ **done**
5. `webview-manager.ts:74` — announce `render-process-gone` to `ProfileManager` and transition the session to `destroyed`
6. `profile-manager.ts:211` — wipe the `persist:<id>` partition + orphan sweep on start, and stop recycling profile ids
7. `main.ts:16` + `window-manager.ts:84` — add `showAndFocus()` for second-instance/activate — ✅ **done**
8. `webview-manager.ts:41` — bind `before-input-event` on each view so shortcuts work while WhatsApp is focused
9. `profile-manager.ts:675` — cache custom-avatar data URLs (invalidate on avatar change) — ✅ **done** (LRU `AvatarCache`)
10. Either emit `IPC_EVENTS.resources` or remove the dead subscription. — ✅ **done** (emitted)

**Also done in the same pass:** `updater.ts` temp-folder cleanup (**L-4**), graceful second-instance exit (**L-14**), split imports (**L-10**), deleted the unreferenced asset (**L-11**), real `publish` URL (**L-12a**), IPC validation (**L-1**), guarded `ProfileStore` writes (**L-2**), delete-active fallback (**M-4**), pop-out detach + return (**M-6**, **L-6**), single first navigation (**L-5**), dead-code sweep (**L-9**), plus a store-state bug the L-2 harness uncovered (**L-15**).

**Verification plan after fixes:** (a) build an old version, publish a newer GitHub release *and* drop a local `latest.yml` + Setup exe in a folder with the app launched from a different CWD, and confirm the installer launches; (b) delete a logged-in profile, create a fresh one, confirm it shows the QR screen and that `%APPDATA%/WhatsZAP/Partitions/` no longer contains the old partition; (c) kill the WhatsApp renderer via Task Manager and confirm the content area reloads instead of going blank; (d) pop out a profile, switch profiles, and confirm the ring/rail behaviour; (e) test Ctrl+1/2, Ctrl+Tab, Ctrl+R while the WhatsApp view is focused.

---

*Report generated from a full read of the repository at commit `3cf5573` (v1.2.5) plus local build/typecheck runs and a targeted spawn reproduction. All line numbers refer to that revision.*
