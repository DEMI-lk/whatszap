import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppSettings, Settings } from '../shared/types';

const DEFAULTS: AppSettings = {
  maxProfiles: 10,
  // Trim/release memory sooner than the original 1536 MB: the platform
  // baseline plus one WhatsApp session already lands around 900 MB of summed
  // working set (see BUG-REPORT.md §6.5), so 1024 MB starts reclaiming before
  // a second profile doubles the footprint.
  ramLimitMB: 1024,
  cpuTargetPercent: 10,
  backgroundMode: false,
  startWithWindows: false,
  activeProfileId: null,
  updatesDir: '',
  accentColor: '#00a884',
  // The app's whole point is being light; "low" costs nothing user-visible
  // and can be flipped to "normal"/"minimal" in Settings > Performance.
  memoryMode: 'low',
};

/** Tiny atomic-JSON settings store (config/settings.json). */
export class SettingsStore {
  private data: Settings;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): Settings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // One-time default move: 1536 MB was the old shipped default, so any
      // file still holding exactly that value was never customised — adopt
      // the new default instead of keeping every existing install above it.
      if (parsed.ramLimitMB === 1536) parsed.ramLimitMB = DEFAULTS.ramLimitMB;
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  get(): Settings {
    return { ...this.data };
  }

  update(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[settings] persist failed:', err);
    }
    return this.get();
  }
}
