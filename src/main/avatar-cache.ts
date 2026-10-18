/**
 * Bounded data-URL cache for avatar images (M-2).
 *
 * `toInfo()` runs for every profile on every snapshot — up to 4×/second while
 * a chat is busy — and a custom avatar meant "read the file + base64-encode it
 * from disk" each time. Avatars only change on explicit user action, and every
 * one of those paths calls `invalidate()`, so the file read happens once.
 *
 * `null` (missing/unreadable file) is cached too: a broken avatar must not
 * retry the disk on every snapshot either.
 */
export class AvatarCache {
  private readonly entries = new Map<string, string | null>();

  constructor(private readonly maxEntries = 32) {}

  get(key: string, load: () => string | null): string | null {
    if (this.entries.has(key)) {
      const hit = this.entries.get(key) ?? null;
      // Refresh recency: delete + re-set moves the key to the end.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const value = load();
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return value;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}
