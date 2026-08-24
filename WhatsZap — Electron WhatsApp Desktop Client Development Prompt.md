# WhatsZAP — Electron WhatsApp Desktop Client

Build an open-source **Windows-first WhatsApp Web desktop client** called **WhatsZAP**, inspired by Linux applications such as ZapZap.

The application should be lightweight, simple, and focused on running WhatsApp Web inside Electron without unnecessary features.

The architecture must be designed so that **Linux and macOS support can be added later**, even though the first release targets Windows only.

## 1. Core Technology

Use:

- Electron
- JavaScript or TypeScript
- HTML/CSS for the UI
- Electron's embedded Chromium/WebContents for WhatsApp Web
- Native OS notification APIs where possible
- Persistent Electron sessions/partitions for WhatsApp profiles

Do **not** use:

- Flutter
- C++
- WebView2 directly
- Electron UI frameworks unless genuinely necessary
- React/Vue/etc. unless there is a strong architectural reason

Prefer **plain TypeScript + HTML/CSS** for the first version to keep the project lightweight and easy to understand.

## 2. Target Platforms

### V1

Windows only.

### Future

The architecture must allow:

- Windows
- Linux
- macOS

Do not introduce Windows-specific logic into the core application unless necessary.

Use platform abstraction layers for things such as:

- Notifications
- Startup
- Tray functionality
- Application paths
- System integration

For example:

```text
src/
├── platform/
│   ├── windows/
│   ├── linux/
│   └── macos/
```

The Linux/macOS implementations can initially be placeholders.

## 3. Application Philosophy

Keep the application extremely simple.

This is primarily:

> A lightweight Electron shell around WhatsApp Web with multiple persistent profiles.

Do not recreate WhatsApp's UI.

WhatsApp Web itself should provide the main interface.

WhatsZAP should only provide:

- Profile switching
- A minimal top shell/menu
- Settings
- Window controls
- Resource monitoring
- Optional background mode later

Avoid adding:

- Chat management
- Contact management
- Custom messaging APIs
- WhatsApp protocol implementations
- Unnecessary UI panels
- Artificial features that WhatsApp Web already provides

## 4. Main Window

The main application should have a minimal custom shell.

Conceptually:

```text
┌──────────────────────────────────────────────────────┐
│  ●  ●  ●       WhatsZAP       Profile   Settings     │
├──────┬───────────────────────────────────────────────┤
│      │                                               │
│  ◉   │                                               │
│      │                                               │
│  ◉   │               WhatsApp Web                    │
│      │                                               │
│  ◉   │                                               │
│      │                                               │
│  +   │                                               │
│      │                                               │
└──────┴───────────────────────────────────────────────┘
```

The profile selector should be a **vertical line of circular profile buttons** on the left side.

## 5. Profile Selector

This is one of the most important UI requirements.

Profiles must be represented as **circles arranged vertically**.

Example:

```text
│
◉
│
○
│
○
│
○
│
+
```

Each circle represents one WhatsApp profile.

### Active profile

The active profile should be visually obvious.

For example:

```text
◉  ← active
○
○
○
```

Use subtle visual differences such as:

- Border
- Scale
- Shadow
- Ring
- Opacity

Do not make the UI excessive or distracting.

### Profile image

Initially, allow:

- Generated initials
- User-selected image

If no image exists, display an initial inside the circle.

Example:

```text
      A
      B
      C
      D
      +
```

The `+` button creates a new profile.

## 6. Maximum Profiles

Support **up to 10 profiles** in V1.

Do not create an unlimited number of profiles.

The architecture should nevertheless make increasing this limit easy later.

Example:

```text
MAX_PROFILES = 10
```

When 10 profiles exist, hide or disable the `+` button.

## 7. Persistent Sessions

Every profile must have its own persistent browser session.

Example:

```text
profiles/
├── profile-01/
├── profile-02/
├── profile-03/
└── ...
```

Each profile must retain its WhatsApp Web login.

If the user closes WhatsZAP and opens it again:

```text
Profile 1
    ↓
Load persistent session
    ↓
WhatsApp Web
    ↓
User remains logged in
```

Do not ask the user to scan the QR code every time.

Do not share cookies/session storage between profiles.

Each profile must be isolated from the others.

## 8. Profile Switching

When the user selects another profile:

```text
Profile 1
    ↓
Profile 2 selected
    ↓
Profile 1 becomes suspended
    ↓
Profile 2 becomes active
```

The goal is to make switching fast while controlling resource consumption.

Do not immediately destroy inactive profiles.

Initially suspend them.

## 9. Resource Management

Implement a resource manager.

Target limits:

### RAM

Maximum desired application usage:

**1.5 GB**

### CPU

Target:

**10% or less average usage**

Do not kill the application because of a short CPU spike.

Use sustained measurements.

For example:

```text
CPU > 10%
for a sustained period
        ↓
monitor
        ↓
attempt resource cleanup
        ↓
if resource usage remains excessive
        ↓
destroy inactive profiles
```

The application should prioritize the active profile.

## 10. Automatic Profile Destruction

If memory usage becomes excessive:

```text
Active profile
     ↓
must remain alive

Inactive profile
     ↓
oldest inactive profile
     ↓
destroy WebContents
```

Continue until memory pressure is reduced.

Important:

**Destroying a profile's WebContents must NOT delete its persistent session.**

Therefore:

```text
Destroy WebContents
       ≠
Delete profile
```

The user should remain logged in.

When the profile is opened again:

```text
Create WebContents
      ↓
Load existing persistent session
      ↓
WhatsApp Web
```

## 11. Profile Lifecycle

Each profile should have states similar to:

```text
ACTIVE
SUSPENDED
DESTROYED
LOADING
```

Example:

```text
Profile 1 → ACTIVE
Profile 2 → SUSPENDED
Profile 3 → DESTROYED
Profile 4 → SUSPENDED
```

Only the selected profile should normally have an active WebContents.

## 12. Background Mode

Do not make background mode overly complicated in V1.

The architecture should support it, but the initial implementation can be minimal.

Two states:

### Normal

```text
User closes window
        ↓
Electron exits
        ↓
All processes terminate
```

### Background mode

If enabled:

```text
User closes window
        ↓
Main Electron process remains alive
        ↓
WhatsApp Web renderer processes are destroyed/suspended
        ↓
Background functionality remains available
```

Do NOT assume that a WhatsApp Web Service Worker can act as a permanent cross-platform notification daemon after Electron is completely terminated.

Use Electron/native OS notification mechanisms where practical.

## 13. Startup

Do not automatically start WhatsZAP with Windows in V1.

Design the architecture so this can be added later.

When implemented:

```text
Windows starts
       ↓
wait approximately 10 seconds
       ↓
start WhatsZAP background mode
```

The delay should eventually be configurable.

## 14. Notifications

Use Electron's notification API and platform-specific notification APIs where appropriate.

Create an abstraction:

```text
NotificationManager
```

with platform implementations.

Example:

```text
NotificationManager
├── WindowsNotificationProvider
├── LinuxNotificationProvider
└── MacOSNotificationProvider
```

V1 only needs the Windows implementation.

Do not build a custom notification server.

## 15. Top Menu

Keep the top menu extremely minimal.

Possible controls:

```text
WhatsZAP

Profile
Settings
Reload
Developer Tools
Exit
```

Do not fill the top bar with unnecessary controls.

The profile circles on the left are the primary profile switching mechanism.

## 16. Settings

V1 settings should be minimal.

Include only useful options such as:

```text
Settings

General
────────────────────────
☐ Start with Windows

Profiles
────────────────────────
Maximum profiles: 10

Performance
────────────────────────
RAM limit: 1.5 GB
CPU target: 10%

Background
────────────────────────
☐ Enable background mode
```

Avoid building a huge settings application.

## 17. Security

Use Electron security best practices.

The WhatsApp Web renderer should NOT have unnecessary Node.js access.

Use:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

where compatible with the implementation.

Use a secure preload bridge for communication between the renderer and main process.

Never expose the entire Electron API to the web page.

## 18. WhatsApp Web Isolation

Treat WhatsApp Web as untrusted web content.

Do not inject unnecessary JavaScript into WhatsApp Web.

Do not attempt to reverse engineer or implement WhatsApp's private communication protocol.

The application should simply provide a browser environment for the official WhatsApp Web application.

## 19. Architecture

Use a modular architecture:

```text
src/
│
├── main/
│   ├── main.ts
│   ├── window-manager.ts
│   ├── profile-manager.ts
│   ├── resource-manager.ts
│   └── background-manager.ts
│
├── profiles/
│   ├── profile-store.ts
│   └── profile-session.ts
│
├── webview/
│   ├── webview-manager.ts
│   └── session-manager.ts
│
├── notifications/
│   ├── notification-manager.ts
│   └── providers/
│
├── platform/
│   ├── windows/
│   ├── linux/
│   └── macos/
│
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── app.ts
│
└── preload/
    └── preload.ts
```

Keep the renderer responsible for UI.

Keep Electron main responsible for:

- Windows
- WebContents
- Profiles
- Resource management
- System integration
- Application lifecycle

## 20. Profile Data

Store profile metadata separately from browser session data.

Example:

```text
WhatsZAP/
├── config/
│   └── profiles.json
│
└── profiles/
    ├── profile-01/
    │   └── browser-data/
    │
    ├── profile-02/
    │   └── browser-data/
    │
    └── profile-03/
        └── browser-data/
```

`profiles.json` might contain:

```json
{
  "profiles": [
    {
      "id": "profile-01",
      "name": "Personal",
      "avatar": null
    }
  ]
}
```

Never store passwords or WhatsApp credentials yourself.

Let the browser session manage authentication.

## 21. Performance

Performance is important.

Avoid:

- Multiple permanently running renderer processes
- Unnecessary React/Vue applications
- Continuous polling
- Heavy animations
- Memory leaks
- Unnecessary IPC messages
- Constant CPU monitoring at extremely high frequency

Use event-driven architecture where possible.

Resource monitoring can sample periodically rather than continuously.

## 22. Important Principle

The application should prioritize:

```text
1. WhatsApp functionality
2. Profile persistence
3. Profile isolation
4. Resource control
5. Simple UI
6. Cross-platform architecture
7. Optional background mode
```

Do not sacrifice reliability just to achieve an arbitrary RAM/CPU number.

## 23. V1 Scope

V1 should include ONLY:

- Electron application
- Windows support
- WhatsApp Web
- Up to 10 profiles
- Persistent login per profile
- Vertical circular profile selector
- Profile switching
- Suspend inactive profiles
- Resource monitoring
- Automatic destruction of old inactive profiles under memory pressure
- Minimal top menu
- Settings
- Secure Electron configuration
- Clean project architecture
- Windows packaging

Do NOT implement yet:

- Linux support
- macOS support
- Android support
- Advanced background notification infrastructure
- Cloud synchronization
- Account backup
- Custom WhatsApp API
- Chat modifications
- Themes marketplace
- Plugins
- Automatic OS startup

## 24. Future Architecture

The project should eventually support:

```text
Windows
Linux
macOS
```

without rewriting the core profile system.

Potential future features:

- Background notifications
- Optional startup
- Tray mode
- Multiple notification providers
- More profile customization
- Configurable profile limits
- Linux/macOS system integration

## 25. Development Requirements

Before writing the implementation:

1. Explain the architecture.
2. Explain the profile lifecycle.
3. Explain how persistent sessions are isolated.
4. Explain how suspended profiles work.
5. Explain how destroyed profiles can be restored without logging in again.
6. Explain the resource monitoring strategy.
7. Explain the security model.
8. Explain which Electron processes exist in each application state.
9. Identify any Electron limitations or assumptions.
10. Then implement V1.

Do not generate a fake implementation that only visually resembles the architecture.

The resulting application must actually launch Electron, create persistent isolated profiles, load WhatsApp Web, switch profiles, and package successfully for Windows.

## 26. UI Design Goal

The UI should feel like a **small native desktop shell around WhatsApp Web**, not like a giant Electron application.

The profile bar should be visually simple:

```text
       │
       ◉
       │
       ○
       │
       ○
       │
       ○
       │
       +
```

The active profile should clearly stand out.

The entire interface should prioritize:

**WhatsApp Web → profile switching → simplicity.**

Do not add unnecessary features merely because they are technically possible.
