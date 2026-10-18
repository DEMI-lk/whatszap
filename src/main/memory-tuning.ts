import { CommandLine } from 'electron';
import { MemoryMode } from '../shared/types';

/**
 * Chromium memory tuning. MUST run before `app.whenReady()` — several of these
 * switches are only read while the first session/renderer is created.
 *
 * Measured on this app with one logged-in profile (5-6 processes, settled):
 *
 *   mode      working set   private   notes
 *   normal    ~880-970 MB   ~470 MB   Chromium defaults
 *   low       ~840-930 MB   ~430 MB   smaller compositor/V8 budgets, no spare
 *                                     renderer, no back/forward page cache
 *   minimal   ~790-800 MB   ~400 MB   low + software rendering: the GPU
 *                                     process drops from ~190 MB to ~70 MB
 *
 * The remaining cost is WhatsApp Web's own page renderer (~350-400 MB) plus
 * Chromium's baseline (main ~110 MB, network/GPU utilities), which no flag
 * removes — see BUG-REPORT.md §Performance.
 */
export function applyMemoryTuning(cmd: CommandLine, mode: MemoryMode): string[] {
  // Unknown/missing values fall back to the default ("low") rather than
  // silently switching the app to Chromium defaults.
  const effective: MemoryMode = mode === 'normal' || mode === 'minimal' ? mode : 'low';
  mode = effective;

  if (mode === 'normal') {
    console.info('[memory] mode=normal — Chromium defaults');
    return [];
  }

  // Shared by "low" and "minimal".
  const featureDisables = [
    'SpareRendererForSitePerProcess', // no pre-warmed spare renderer process kept alive
    'BackForwardCache', // WhatsApp Web is an SPA; the page cache only costs RAM
    'AudioServiceOutOfProcess', // consolidate the audio service into the browser process
  ];
  const switches: string[] = [
    // Smaller compositor tile / image / V8 budgets and more aggressive memory
    // purging — the same mode Chrome uses on low-RAM devices.
    '--enable-low-end-device-mode',
    // Cap the renderer V8 heap so WhatsApp Web collects garbage instead of
    // letting its old space balloon (0 = Chromium's own, much larger, default).
    '--js-flags=--max-old-space-size=512',
    `--disable-features=${featureDisables.join(',')}`,
  ];

  if (mode === 'minimal') {
    // Software rendering: removes the ~120 MB hardware-accelerated GPU
    // process. Costs CPU on scrolling/animations and disables WebGL/video
    // post-processing — offered as an explicit trade-off, never the default.
    switches.push('--disable-gpu');
  }

  for (const s of switches) {
    const body = s.replace(/^--/, '');
    const eq = body.indexOf('=');
    if (eq === -1) cmd.appendSwitch(body);
    else cmd.appendSwitch(body.slice(0, eq), body.slice(eq + 1));
  }

  console.info(`[memory] mode=${mode} — ${switches.join(' ')}`);
  return switches;
}
