// Ambient declarations so renderer/app.ts stays a plain (non-module) script:
// no import statements -> tsc emits browser-safe JS with no CJS wrapper.
import type { WhatsZapApi } from '../preload/preload';

declare global {
  interface Window {
    whatszap: WhatsZapApi;
  }
  type AppSettings = import('../shared/types').AppSettings;
  type ContentBounds = import('../shared/types').ContentBounds;
  type ProfileInfo = import('../shared/types').ProfileInfo;
  type ResourceSample = import('../shared/types').ResourceSample;
}

export {};
