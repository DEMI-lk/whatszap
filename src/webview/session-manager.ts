import { session, Session } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * One persistent Chromium session (partition) per profile. Partitions give
 * full isolation of cookies / localStorage / IndexedDB / Service Workers
 * between profiles and persist to disk under:
 *   %APPDATA%/WhatsZAP/Partitions/<partition-name>/
 *
 * Destroying a profile's WebContents never touches this directory, so a
 * destroyed profile can be reopened without scanning the QR code again.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly profilesRoot: string) {}

  /** Chrome UA derived from the embedded Chromium version (no Electron token). */
  static chromeUserAgent(): string {
    return (
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
    );
  }

  /** Client-hint brand list matching Chrome so WhatsApp's checks pass. */
  private static secChUa(): string {
    const major = process.versions.chrome.split('.')[0];
    return `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not;A=Brand";v="24"`;
  }

  /** Returns the persistent session for a profile, configuring it once. */
  forProfile(profileId: string): Session {
    const existing = this.sessions.get(profileId);
    if (existing) return existing;

    const partition = `persist:${profileId}`;
    const ses = session.fromPartition(partition, { cache: true });

    // Keep a marker directory per profile so on-disk layout mirrors metadata.
    // (Chromium controls the actual partition storage location; see README.)
    const marker = path.join(this.profilesRoot, profileId);
    try {
      fs.mkdirSync(marker, { recursive: true });
    } catch {
      /* non-fatal */
    }

    ses.setUserAgent(SessionManager.chromeUserAgent());

    // Rewrite identity headers on every request: WhatsApp rejects requests
    // whose Sec-CH-UA client hints still advertise Electron.
    const ua = SessionManager.chromeUserAgent();
    const secChUa = SessionManager.secChUa();
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      headers['User-Agent'] = ua;
      if (headers['sec-ch-ua'] !== undefined) headers['sec-ch-ua'] = secChUa;
      if (headers['sec-ch-ua-full-version-list'] !== undefined) {
        const full = process.versions.chrome;
        headers['sec-ch-ua-full-version-list'] =
          `"Chromium";v="${full}", "Google Chrome";v="${full}", "Not;A=Brand";v="24"`;
      }
      callback({ requestHeaders: headers });
    });

    // Treat WhatsApp Web as untrusted content: deny everything not required.
    const allowed = new Set(['media', 'notifications', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowed.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    // Block navigation attempts away from WhatsApp-owned domains.
    const allowedOrigin = /^https:\/\/([\w-]+\.)*whatsapp\.(com|net)(\/|$)/;
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const ok =
        details.resourceType === 'mainFrame'
          ? allowedOrigin.test(details.url)
          : true;
      callback({ cancel: !ok });
    });

    this.sessions.set(profileId, ses);
    return ses;
  }

  clearCache(profileId: string): Promise<void> {
    return this.forProfile(profileId).clearCache();
  }
}
