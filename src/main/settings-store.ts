import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppSettings, Settings } from '../shared/types';

const DEFAULTS: AppSettings = {
  maxProfiles: 10,
  ramLimitMB: 1536,
  cpuTargetPercent: 10,
  backgroundMode: false,
  startWithWindows: false,
  activeProfileId: null,
  updatesDir: '',
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
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
