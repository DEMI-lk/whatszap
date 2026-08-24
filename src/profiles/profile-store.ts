import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProfileMeta } from '../shared/types';

interface ProfilesFile {
  profiles: ProfileMeta[];
}

const EMPTY: ProfilesFile = { profiles: [] };

/**
 * Persists profile metadata (names, avatars) separately from browser session
 * data. Writes are atomic (tmp file + rename) to survive crashes.
 */
export class ProfileStore {
  private cache: ProfileMeta[] | null = null;

  constructor(private readonly filePath: string) {}

  private load(): ProfilesFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ProfilesFile;
      if (!parsed || !Array.isArray(parsed.profiles)) return { ...EMPTY };
      return parsed;
    } catch {
      return { ...EMPTY };
    }
  }

  private save(data: ProfilesFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
    this.cache = data.profiles;
  }

  private ensure(): ProfilesFile {
    if (this.cache === null) {
      this.cache = this.load().profiles;
    }
    return { profiles: this.cache };
  }

  list(): ProfileMeta[] {
    return [...this.ensure().profiles];
  }

  count(): number {
    return this.ensure().profiles.length;
  }

  get(id: string): ProfileMeta | undefined {
    return this.ensure().profiles.find((p) => p.id === id);
  }

  add(profile: ProfileMeta): void {
    const data = this.ensure();
    data.profiles.push(profile);
    this.save(data);
  }

  update(id: string, patch: Partial<Pick<ProfileMeta, 'name' | 'avatar' | 'keepAlive'>>): void {
    const data = this.ensure();
    const idx = data.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return;
    data.profiles[idx] = { ...data.profiles[idx], ...patch };
    this.save(data);
  }

  remove(id: string): void {
    const data = this.ensure();
    data.profiles = data.profiles.filter((p) => p.id !== id);
    this.save(data);
  }

  nextProfileId(): string {
    const existing = new Set(this.list().map((p) => p.id));
    for (let i = 1; i <= 999; i++) {
      const id = `profile-${String(i).padStart(2, '0')}`;
      if (!existing.has(id)) return id;
    }
    throw new Error('No available profile ids');
  }
}
