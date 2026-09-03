/**
 * Daily loss protection.
 *
 * Accumulates realized losses per UTC trading day through the storage
 * abstraction, so a pause survives page reloads. Timestamps are always
 * injected by the caller — this module never reads the wall clock, which
 * keeps it deterministic and testable.
 */

import type { KeyValueStore } from '../data/storage';
import type { RiskLimits } from './riskEngine';

interface DailyLossState {
  /** UTC day key, e.g. "2026-07-09". */
  day: string;
  /** Accumulated realized loss for that day (positive number). */
  loss: number;
}

const STORAGE_KEY = 'daily-loss';

function utcDayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class DailyLossTracker {
  constructor(private readonly store: KeyValueStore) {}

  private stateFor(timestamp: number): DailyLossState {
    const saved = this.store.get<DailyLossState>(STORAGE_KEY);
    const day = utcDayOf(timestamp);
    if (saved === undefined || saved.day !== day) {
      return { day, loss: 0 }; // new day: the counter resets
    }
    return saved;
  }

  /** Record a realized P&L event. Gains are ignored by the loss counter. */
  record(pnl: number, timestamp: number): void {
    if (!Number.isFinite(pnl) || pnl >= 0) return;
    const state = this.stateFor(timestamp);
    this.store.set<DailyLossState>(STORAGE_KEY, {
      day: state.day,
      loss: state.loss + -pnl,
    });
  }

  /** Realized loss accumulated so far in the timestamp's UTC day. */
  lossToday(timestamp: number): number {
    return this.stateFor(timestamp).loss;
  }

  /**
   * True when today's losses have consumed the configured allowance.
   * `dailyLossLimitPct: 0` means the check is DISABLED (never pauses) — the
   * same convention `assessTrade` (riskEngine.ts) already uses for its own
   * inline daily-loss check. Found in review, 2026-09-03: this used to
   * treat 0 as an allowance of exactly €0, so with zero losses recorded the
   * comparison `0 >= 0` was already true — pausing ALL trading from the
   * first call of the day, the opposite of "disabled".
   */
  isPaused(timestamp: number, equity: number, limits: RiskLimits): boolean {
    if (!(equity > 0)) return false;
    const allowance = equity * (limits.dailyLossLimitPct / 100);
    if (!(allowance > 0)) return false;
    return this.lossToday(timestamp) >= allowance;
  }
}
