const api = window.whatszap;

const railList = document.getElementById('rail-list') as HTMLDivElement;
const btnAdd = document.getElementById('btn-add-profile') as HTMLButtonElement;
const loadingHint = document.getElementById('loading-hint') as HTMLDivElement;
const content = document.getElementById('content') as HTMLElement;
const resChip = document.getElementById('res-chip') as HTMLDivElement;

const profileMenu = document.getElementById('profile-menu') as HTMLDivElement;
const profileMenuList = document.getElementById('profile-menu-list') as HTMLDivElement;
const moreMenu = document.getElementById('more-menu') as HTMLDivElement;
const circleMenu = document.getElementById('circle-menu') as HTMLDivElement;

const backdrop = document.getElementById('modal-backdrop') as HTMLDivElement;
const modalTitle = document.getElementById('modal-title') as HTMLHeadingElement;
const panelName = document.querySelector('[data-panel="name"]') as HTMLElement;
const panelSettings = document.querySelector('[data-panel="settings"]') as HTMLElement;
const inputName = document.getElementById('input-name') as HTMLInputElement;
const setStartup = document.getElementById('set-startup') as HTMLInputElement;
const setMaxProfiles = document.getElementById('set-max-profiles') as HTMLElement;
const setRam = document.getElementById('set-ram') as HTMLInputElement;
const setCpu = document.getElementById('set-cpu') as HTMLInputElement;
const setBackground = document.getElementById('set-background') as HTMLInputElement;

const appVersionChip = document.getElementById('app-version') as HTMLDivElement;
const updVersion = document.getElementById('upd-version') as HTMLElement;
const updDir = document.getElementById('upd-dir') as HTMLInputElement;
const updCheck = document.getElementById('upd-check') as HTMLButtonElement;
const updInstall = document.getElementById('upd-install') as HTMLButtonElement;
const updStatus = document.getElementById('upd-status') as HTMLParagraphElement;

let profiles: ProfileInfo[] = [];
let settings: AppSettings | null = null;
let activeId: string | null = null;
let circleMenuFor: string | null = null;
let modalMode: 'new' | 'rename' | 'settings' = 'new';
let renameTarget: string | null = null;

// ------------------------------------------------------------------- render

function initials(p: ProfileInfo): string {
  return p.initials || p.name.slice(0, 2).toUpperCase();
}

function renderRail(): void {
  railList.textContent = '';
  for (const p of profiles) {
    const popped = p.poppedOut;
    const sleeping = !p.keepAlive && !popped;
    const focused = p.id === activeId && !popped;

    const el = document.createElement('button');
    el.className = 'circle';
    if (focused) el.classList.add('active');
    else if (sleeping) el.classList.add('sleeping');
    else if (p.state === 'suspended') el.classList.add('inactive-state');
    else if (p.state === 'destroyed') el.classList.add('destroyed-state');

    const stateText = popped
      ? 'open in own window'
      : p.keepAlive
        ? `keep alive (${p.state})`
        : `sleep (${p.state})`;
    el.title = `${p.name} — ${stateText}`;
    el.setAttribute('role', 'option');

    if (p.avatarDataUrl) {
      const img = document.createElement('img');
      img.src = p.avatarDataUrl;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = initials(p);
    }

    // Presence dot: green = live account, gray = sleeping.
    const presence = document.createElement('span');
    presence.className = `presence ${p.keepAlive || popped ? 'on' : 'off'}`;
    el.appendChild(presence);

    if (popped) {
      const wb = document.createElement('span');
      wb.className = 'winbadge';
      wb.textContent = '⧉';
      el.appendChild(wb);
    }

    if (p.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = p.unread > 99 ? '99+' : String(p.unread);
      el.appendChild(badge);
    }

    el.addEventListener('click', () => {
      // Popped-out profiles: focuses their window (main handles the guard).
      if (!focused && !(p.id === activeId && p.state === 'active')) {
        api.selectProfile(p.id);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCircleMenu(e.clientX, e.clientY, p.id);
    });
    railList.appendChild(el);
  }
  btnAdd.disabled = profiles.length >= (settings?.maxProfiles ?? 10);
}

function renderProfileMenu(): void {
  profileMenuList.textContent = '';
  for (const p of profiles) {
    const b = document.createElement('button');
    b.textContent = `${p.id === activeId ? '● ' : '○ '}${p.name}`;
    b.addEventListener('click', () => {
      hideMenus();
      if (p.id !== activeId) api.selectProfile(p.id);
    });
    profileMenuList.appendChild(b);
  }
}

function applyChromeVisibility(visible: boolean): void {
  document.body.classList.toggle('chrome-hidden', !visible);
  reportBounds();
}

// ------------------------------------------------------------------ bounds

function reportBounds(): void {
  requestAnimationFrame(() => {
    const rect = content.getBoundingClientRect();
    const bounds: ContentBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    api.sendContentBounds(bounds);
  });
}

new ResizeObserver(reportBounds).observe(content);
window.addEventListener('resize', reportBounds);

// -------------------------------------------------------------------- menus

/**
 * Shell overlays live below the native WhatsApp view, so the view must hide
 * whenever any menu/modal is open (and return when none are).
 */
let viewHiddenForOverlay = false;
function syncOverlay(): void {
  const open = [profileMenu, moreMenu, circleMenu, backdrop].some(
    (el) => !el.classList.contains('hidden'),
  );
  if (open !== viewHiddenForOverlay) {
    viewHiddenForOverlay = open;
    api.setViewVisible(!open);
  }
}

function hideMenus(): void {
  for (const m of [profileMenu, moreMenu, circleMenu]) m.classList.add('hidden');
  syncOverlay();
}
function toggleMenu(menu: HTMLElement, anchorRight: boolean): void {
  const wasHidden = menu.classList.contains('hidden');
  hideMenus();
  if (!wasHidden) return;
  menu.style.top = '34px';
  if (anchorRight) {
    menu.style.right = '10px';
    menu.style.left = 'auto';
  } else {
    menu.style.left = '10px';
    menu.style.right = 'auto';
  }
  menu.classList.remove('hidden');
  syncOverlay();
}
function positionAt(x: number, y: number, menu: HTMLElement): void {
  hideMenus();
  menu.classList.remove('hidden');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.right = 'auto';
  const r = menu.getBoundingClientRect();
  if (r.bottom > innerHeight) menu.style.top = `${Math.max(4, y - r.height)}px`;
  if (r.right > innerWidth) menu.style.left = `${Math.max(4, x - r.width)}px`;
  syncOverlay();
}

document.getElementById('btn-profile-menu')!.addEventListener('click', () => {
  renderProfileMenu();
  toggleMenu(profileMenu, true);
});
document.getElementById('btn-more')!.addEventListener('click', () => toggleMenu(moreMenu, true));
document.getElementById('menu-new-profile')!.addEventListener('click', () => { hideMenus(); openModal('new'); });
document.getElementById('menu-reload')!.addEventListener('click', () => { hideMenus(); api.reloadActive(); });
document.getElementById('menu-devtools')!.addEventListener('click', () => { hideMenus(); api.toggleDevTools(); });
document.getElementById('menu-exit')!.addEventListener('click', () => api.exitApp());
document.getElementById('btn-settings')!.addEventListener('click', () => openModal('settings'));

document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('.menu') && !t.closest('#topmenu')) hideMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideMenus(); closeModal(); }
});

function openCircleMenu(x: number, y: number, id: string): void {
  circleMenuFor = id;
  const p = profiles.find((x2) => x2.id === id);
  const keepaliveBtn = circleMenu.querySelector('[data-action="keepalive"]') as HTMLButtonElement;
  const popoutBtn = circleMenu.querySelector('[data-action="popout"]') as HTMLButtonElement;
  const popinBtn = circleMenu.querySelector('[data-action="popin"]') as HTMLButtonElement;
  if (p) {
    keepaliveBtn.textContent = p.keepAlive ? 'Keep alive: On' : 'Keep alive: Off';
    popoutBtn.textContent = p.poppedOut ? 'Focus pop-out window' : 'Pop out window';
    popinBtn.classList.toggle('hidden', !p.poppedOut);
  }
  positionAt(x, y, circleMenu);
}
circleMenu.addEventListener('click', async (e) => {
  const action = (e.target as HTMLElement).dataset.action;
  if (!action || !circleMenuFor) return;
  const id = circleMenuFor;
  const p = profiles.find((x) => x.id === id);
  hideMenus();
  if (action === 'keepalive' && p) await api.setKeepAlive(id, !p.keepAlive);
  else if (action === 'popout') await api.popoutProfile(id);
  else if (action === 'popin') await api.popinProfile(id);
  else if (action === 'rename') openModal('rename', id);
  else if (action === 'avatar') await api.pickAvatar(id);
  else if (action === 'avatar-remove') await api.removeAvatar(id);
  else if (action === 'delete') {
    if (p && confirm(`Delete "${p.name}" and its WhatsApp session data?\nThis cannot be undone.`)) {
      await api.deleteProfile(id);
    }
  }
});

// ------------------------------------------------------------------- modals

function openModal(mode: 'new' | 'rename' | 'settings', targetId?: string): void {
  modalMode = mode;
  renameTarget = targetId ?? null;
  backdrop.classList.remove('hidden');
  syncOverlay();

  const isName = mode !== 'settings';
  panelName.classList.toggle('hidden', !isName);
  panelSettings.classList.toggle('hidden', isName);

  if (mode === 'new') {
    modalTitle.textContent = 'New profile';
    inputName.value = '';
    (document.getElementById('modal-ok') as HTMLButtonElement).textContent = 'Create';
    setTimeout(() => inputName.focus(), 0);
  } else if (mode === 'rename') {
    const p = profiles.find((x) => x.id === targetId);
    modalTitle.textContent = 'Rename profile';
    inputName.value = p?.name ?? '';
    (document.getElementById('modal-ok') as HTMLButtonElement).textContent = 'Save';
    setTimeout(() => inputName.select(), 0);
  } else {
    modalTitle.textContent = 'Settings';
    fillSettings();
    (document.getElementById('modal-ok') as HTMLButtonElement).textContent = 'Save';
  }
}

function closeModal(): void {
  backdrop.classList.add('hidden');
  syncOverlay();
}

function fillSettings(): void {
  if (!settings) return;
  setMaxProfiles.textContent = String(settings.maxProfiles);
  setStartup.checked = settings.startWithWindows;
  setRam.value = String(settings.ramLimitMB);
  setCpu.value = String(settings.cpuTargetPercent);
  setBackground.checked = settings.backgroundMode;
  updDir.value = settings.updatesDir || '';
  updateBackgroundHint();
  void refreshUpdaterInfo();
}

async function refreshUpdaterInfo(): Promise<void> {
  try {
    const info = await api.getUpdaterInfo();
    appVersionChip.textContent = `WhatsZAP v${info.appVersion}`;
    updVersion.textContent = `v${info.appVersion}`;
    updInstall.disabled = !info.availableVersion;
    if (info.availableVersion) {
      updStatus.textContent = `Update available: v${info.availableVersion}`;
    } else if (info.status.state !== 'idle' && info.status.message) {
      updStatus.textContent = info.status.message;
    }
  } catch { /* main not ready */ }
}

function updateBackgroundHint(): void {
  const el = document.getElementById('set-background-state');
  if (el) {
    el.textContent = setBackground.checked
      ? 'Active — closing the window keeps WhatsZAP running in the tray.'
      : 'Inactive — closing the window exits WhatsZAP.';
  }
}

async function submitModal(): Promise<void> {
  if (modalMode === 'new') {
    const name = inputName.value.trim();
    const created = await api.createProfile(name || undefined);
    if (created) activeId = created.id;
  } else if (modalMode === 'rename' && renameTarget) {
    await api.renameProfile(renameTarget, inputName.value.trim() || 'Profile');
  } else if (modalMode === 'settings') {
    settings = await api.updateSettings({
      startWithWindows: setStartup.checked,
      ramLimitMB: clamp(parseInt(setRam.value, 10), 512, 8192, settings?.ramLimitMB ?? 1536),
      cpuTargetPercent: clamp(parseInt(setCpu.value, 10), 5, 100, settings?.cpuTargetPercent ?? 10),
      backgroundMode: setBackground.checked,
      updatesDir: updDir.value.trim(),
    });
  }
  closeModal();
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback!;
  return Math.min(max, Math.max(min, v));
}

document.getElementById('modal-cancel')!.addEventListener('click', closeModal);
document.getElementById('modal-ok')!.addEventListener('click', submitModal);
backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitModal(); });
setBackground.addEventListener('change', updateBackgroundHint);

updDir.addEventListener('change', () => {
  void api.updateSettings({ updatesDir: updDir.value.trim() });
});
updCheck.addEventListener('click', () => {
  updCheck.disabled = true;
  updStatus.textContent = 'Checking…';
  void api.checkUpdates().finally(() => (updCheck.disabled = false));
});
updInstall.addEventListener('click', () => {
  updInstall.disabled = true;
  void api.installUpdate();
});
api.onUpdaterStatus((s) => {
  updStatus.textContent = s.message;
  if (s.state === 'available') updInstall.disabled = false;
  else if (s.state === 'installing') updInstall.disabled = true;
  else if (s.state === 'error' || s.state === 'up-to-date') updInstall.disabled = true;
});

// ------------------------------------------------------------------ events

api.onSnapshot((list) => {
  profiles = list;
  // Reflect reality: no active profile (e.g. while backgrounded/loading)
  // means no highlighted circle.
  const current = list.find((p) => p.state === 'active');
  activeId = current ? current.id : null;
  renderRail();
  loadingHint.style.opacity = activeId ? '0' : '1';
});
api.onResources((s: ResourceSample) => {
  resChip.textContent = `RAM ${s.totalRamMB}/${s.ramLimitMB} MB · CPU ${s.cpuPercent}%`;
  resChip.title = `Governor last action: ${s.lastAction}`;
});
api.onChromeVisibility(applyChromeVisibility);

api.onShortcut('reload', () => api.reloadActive());
api.onShortcut('devtools', () => api.toggleDevTools());
api.onShortcut('profile-next', () => cycleProfile(1));
api.onShortcut('profile-prev', () => cycleProfile(-1));

function cycleProfile(dir: 1 | -1): void {
  if (profiles.length < 2) return;
  const idx = profiles.findIndex((p) => p.id === activeId);
  const next = profiles[(idx + dir + profiles.length) % profiles.length]!;
  api.selectProfile(next.id);
}

btnAdd.addEventListener('click', () => openModal('new'));

// Double-click a circle to rename.
railList.addEventListener('dblclick', (e) => {
  const circle = (e.target as HTMLElement).closest('.circle');
  if (!circle) return;
  const idx = Array.from(railList.children).indexOf(circle);
  const p = profiles[idx];
  if (p) openModal('rename', p.id);
});

// -------------------------------------------------------------------- boot

(async function boot() {
  settings = await api.getSettings();
  profiles = await api.getProfiles();
  const current = profiles.find((p) => p.state === 'active');
  activeId = current ? current.id : null;
  renderRail();
  reportBounds();
  void refreshUpdaterInfo();

  // Poll resources lightly so the chip stays fresh even without pressure.
  setInterval(async () => {
    try {
      const s = await api.getResources();
      resChip.textContent = `RAM ${s.totalRamMB}/${s.ramLimitMB} MB · CPU ${s.cpuPercent}%`;
      resChip.title = `Governor last action: ${s.lastAction}`;
    } catch { /* window closing */ }
  }, 15000);
})();
