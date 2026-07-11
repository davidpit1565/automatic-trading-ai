/**
 * Scheduler abstraction — Stage 4.
 *
 * Business logic never owns timers: the monitoring engine is handed a
 * Scheduler, so timing is replaceable (real intervals in the app, manual
 * ticks in tests, potentially server cron later).
 */

export type MonitorInterval = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export const MONITOR_INTERVALS: Record<MonitorInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export type ScheduledTask = () => void | Promise<void>;

export interface Scheduler {
  /** Replace any existing schedule with a new one. */
  start(intervalMs: number, task: ScheduledTask): void;
  stop(): void;
  isRunning(): boolean;
  /** Active interval, or null when stopped. */
  intervalMs(): number | null;
}

/** Real-timer scheduler used by the dashboard. */
export class IntervalScheduler implements Scheduler {
  private handle: ReturnType<typeof setInterval> | null = null;
  private activeIntervalMs: number | null = null;

  start(intervalMs: number, task: ScheduledTask): void {
    if (!(intervalMs > 0)) throw new RangeError(`intervalMs must be > 0, got ${intervalMs}`);
    this.stop();
    this.activeIntervalMs = intervalMs;
    this.handle = setInterval(() => {
      void task();
    }, intervalMs);
  }

  stop(): void {
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
    this.activeIntervalMs = null;
  }

  isRunning(): boolean {
    return this.handle !== null;
  }

  intervalMs(): number | null {
    return this.activeIntervalMs;
  }
}

/** Deterministic scheduler for tests: fires only on explicit tick(). */
export class ManualScheduler implements Scheduler {
  private task: ScheduledTask | null = null;
  private activeIntervalMs: number | null = null;

  start(intervalMs: number, task: ScheduledTask): void {
    if (!(intervalMs > 0)) throw new RangeError(`intervalMs must be > 0, got ${intervalMs}`);
    this.task = task;
    this.activeIntervalMs = intervalMs;
  }

  stop(): void {
    this.task = null;
    this.activeIntervalMs = null;
  }

  isRunning(): boolean {
    return this.task !== null;
  }

  intervalMs(): number | null {
    return this.activeIntervalMs;
  }

  async tick(): Promise<void> {
    if (this.task !== null) await this.task();
  }
}
