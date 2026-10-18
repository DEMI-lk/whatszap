import { ContentBounds, MAX_PROFILES, MemoryMode, Settings } from '../shared/types';

/**
 * IPC trust boundary (L-1).
 *
 * The renderer already clamps its own inputs, but it is the *untrusted* side of
 * the bridge: everything arriving over `ipcMain` is treated as `unknown` here
 * and either normalised into the expected range/type or dropped. Dropping a key
 * means "keep the current value", so hostile or buggy payloads can never write
 * a nonsensical setting (`ramLimitMB: -1`, `accentColor: 'javascript:'`,
 * `activeProfileId: 'other'`, NaN bounds) into settings.json.
 */

const MEMORY_MODES: readonly MemoryMode[] = ['normal', 'low', 'minimal'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Sane bounds for numbers arriving from the shell. */
export const LIMITS = {
  ramLimitMB: { min: 512, max: 8192 },
  cpuTargetPercent: { min: 5, max: 100 },
  maxProfiles: { min: 1, max: MAX_PROFILES },
  updatesDirLength: 1000,
  nameLength: 24,
  /** Window-position range: generous enough for multi-monitor desktops. */
  boundsPosition: 20_000,
  boundsSize: 20_000,
} as const;

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Filters + clamps a renderer settings patch. Unknown keys are ignored. */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (!isRecord(raw)) return {};
  const out: Partial<Settings> = {};

  if ('maxProfiles' in raw) {
    const v = clampInt(raw.maxProfiles, LIMITS.maxProfiles.min, LIMITS.maxProfiles.max);
    if (v !== undefined) out.maxProfiles = v;
  }
  if ('ramLimitMB' in raw) {
    const v = clampInt(raw.ramLimitMB, LIMITS.ramLimitMB.min, LIMITS.ramLimitMB.max);
    if (v !== undefined) out.ramLimitMB = v;
  }
  if ('cpuTargetPercent' in raw) {
    const v = clampInt(raw.cpuTargetPercent, LIMITS.cpuTargetPercent.min, LIMITS.cpuTargetPercent.max);
    if (v !== undefined) out.cpuTargetPercent = v;
  }
  if ('backgroundMode' in raw && typeof raw.backgroundMode === 'boolean') {
    out.backgroundMode = raw.backgroundMode;
  }
  if ('startWithWindows' in raw && typeof raw.startWithWindows === 'boolean') {
    out.startWithWindows = raw.startWithWindows;
  }
  if ('updatesDir' in raw && typeof raw.updatesDir === 'string') {
    out.updatesDir = raw.updatesDir.trim().slice(0, LIMITS.updatesDirLength);
  }
  if ('accentColor' in raw && typeof raw.accentColor === 'string' && HEX_COLOR.test(raw.accentColor.trim())) {
    out.accentColor = raw.accentColor.trim().toLowerCase();
  }
  if ('memoryMode' in raw && MEMORY_MODES.includes(raw.memoryMode as MemoryMode)) {
    out.memoryMode = raw.memoryMode as MemoryMode;
  }
  return out;
}

/** Validates the shell's content-area rectangle; null = ignore the report. */
export function sanitizeBounds(raw: unknown): ContentBounds | null {
  if (!isRecord(raw)) return null;
  const nums: number[] = [];
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    nums.push(value);
  }
  const [x, y, width, height] = nums as [number, number, number, number];
  const pos = LIMITS.boundsPosition;
  const size = LIMITS.boundsSize;
  return {
    x: Math.min(pos, Math.max(-pos, Math.round(x))),
    y: Math.min(pos, Math.max(-pos, Math.round(y))),
    width: Math.min(size, Math.max(0, Math.round(width))),
    height: Math.min(size, Math.max(0, Math.round(height))),
  };
}

/** Trims + caps a profile name coming from the renderer. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.trim().slice(0, LIMITS.nameLength);
  return clean || fallback;
}
