import { app, ipcMain } from 'electron';
import { IPC, ResourceSample, Settings } from '../shared/types';

/**
 * Event-driven resource governor.
 *
 * - Samples `app.getAppMetrics()` every `sampleMs` (default 15s): the summed
 *   working set of ALL Chromium processes approximates total RAM; CPU uses
 *   summed per-process percentCPUUsage fed into a rolling window so short
 *   spikes never trigger action — only sustained pressure does.
 * - Mitigation ladder: clear inactive sessions' caches -> destroy the oldest
 *   inactive profile's WebContents (one per cycle). The active profile and
 *   the last inactive profile are never destroyed automatically.
 */
export class ResourceManager {
  private timer: NodeJS.Timeout | null = null;
  private readonly cpuWindow: number[] = [];
  private lastAction = 'none';
  /** Tracks RAM band crossings so "approaching limit" logs fire once. */
  private ramBand: 'ok' | 'warn' = 'ok';
  private latest: ResourceSample = {
    totalRamMB: 0,
    cpuPercent: 0,
    ramLimitMB: 1536,
    cpuTargetPercent: 10,
    lastAction: 'none',
  };

  private readonly sampleMs = 15_000;
  private readonly sustainedSamples = 8; // ~2 minutes

  constructor(
    private settings: Settings,
    private readonly hooks: {
      onRamPressure: () => void;
      onCpuSustained: () => void;
      clearInactiveCaches: () => void;
      destroyOldestInactive: () => string | null;
      inactiveCount: () => number;
    },
  ) {
    this.settings.ramLimitMB = this.settings.ramLimitMB || 1536;
    this.settings.cpuTargetPercent = this.settings.cpuTargetPercent || 10;
    this.latest.ramLimitMB = this.settings.ramLimitMB;
    this.latest.cpuTargetPercent = this.settings.cpuTargetPercent;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.sampleMs);
    this.timer.unref?.();
    // First sample immediately so the UI has data right away.
    this.sample();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  registerIpc(): void {
    ipcMain.handle(IPC.getResources, () => this.latest);
  }

  current(): ResourceSample {
    return this.latest;
  }

  updateLimits(ramLimitMB: number, cpuTargetPercent: number): void {
    this.settings.ramLimitMB = ramLimitMB || this.settings.ramLimitMB;
    this.settings.cpuTargetPercent = cpuTargetPercent ?? this.settings.cpuTargetPercent;
  }

  private sample(): void {
    const metrics = app.getAppMetrics();
    let ramKB = 0;
    let cpu = 0;
    for (const m of metrics) {
      ramKB += m.memory?.workingSetSize ?? 0;
      cpu += m.cpu?.percentCPUUsage ?? 0;
    }
    const ramMB = Math.round(ramKB / 1024);

    this.cpuWindow.push(cpu);
    if (this.cpuWindow.length > this.sustainedSamples) this.cpuWindow.shift();

    this.latest = {
      totalRamMB: ramMB,
      cpuPercent: Math.round(cpu * 10) / 10,
      ramLimitMB: this.settings.ramLimitMB,
      cpuTargetPercent: this.settings.cpuTargetPercent,
      lastAction: this.lastAction,
    };
    this.logBands(ramMB);
    this.enforce();
  }

  /** One-line visibility when RAM crosses 80% of the limit (and back). */
  private logBands(ramMB: number): void {
    const warnAt = this.settings.ramLimitMB * 0.8;
    if (this.ramBand === 'ok' && ramMB > warnAt) {
      this.ramBand = 'warn';
      console.info(
        `[resources] RAM ${ramMB} MB is above 80% of the ${this.settings.ramLimitMB} MB limit ` +
          `(inactive profiles: ${this.hooks.inactiveCount()})`,
      );
    } else if (this.ramBand === 'warn' && ramMB < this.settings.ramLimitMB * 0.75) {
      this.ramBand = 'ok';
      console.info(`[resources] RAM back to ${ramMB} MB (below 75% of limit)`);
    }
  }

  private enforce(): void {
    const ramOver = this.latest.totalRamMB > this.settings.ramLimitMB;
    const avgCpu = this.cpuWindow.reduce((a, b) => a + b, 0) / Math.max(1, this.cpuWindow.length);
    const cpuOver = avgCpu > this.settings.cpuTargetPercent && this.cpuWindow.length >= this.sustainedSamples;

    if (!ramOver && !cpuOver) return;

    console.info(
      `[resources] pressure detected: RAM ${this.latest.totalRamMB}/${this.settings.ramLimitMB} MB, ` +
        `CPU avg ${avgCpu.toFixed(1)}% / target ${this.settings.cpuTargetPercent}%`,
    );

    if (cpuOver) {
      this.hooks.clearInactiveCaches();
      this.lastAction = 'cleared inactive caches (sustained CPU)';
    }

    // One destruction per cycle; next cycle re-evaluates with fresh samples.
    if (this.hooks.inactiveCount() > 1) {
      const victim = this.hooks.destroyOldestInactive();
      this.lastAction = victim ? `destroyed ${victim} (oldest inactive)` : 'destroy skipped';
    } else {
      this.lastAction = 'kept last inactive profile (reliability floor)';
      console.info('[resources] no safe inactive profile to destroy; keeping reliability over limits');
    }
  }
}
