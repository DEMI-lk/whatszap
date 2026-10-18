import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProfileMeta } from '../shared/types';

interface ProfilesFile {
  profiles: ProfileMeta[];
}

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
      if (!parsed || !Array.isArray(parsed.profiles)) return { profiles: [] };
      return parsed;
    } catch {
      // NOTE: always a FRESH array. Spreading a shared `EMPTY` object used to
      // hand every store the same `profiles` array, so an instance whose file
      // was missing/corrupt started life with whatever another instance had
      // pushed in the meantime.
      return { profiles: [] };
    }
  }

  private save(data: ProfilesFile): void {
    // The in-memory list is authoritative even when the write fails, so a
    // locked/full %APPDATA% can't throw out of an IPC handler and leave the
    // app listing a different set of profiles than its own cache (L-2). The
    // next successful save writes the whole list, so it self-heals.
    this.cache = data.profiles;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[profiles] persist failed:', err);
    }
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
