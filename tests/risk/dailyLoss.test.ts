/**
 * Daily loss protection tests (TDD).
 *
 * Losses accumulate per UTC trading day; when they exceed the configured
 * share of equity, no new trades are allowed until the next day. Timestamps
 * are always injected — the tracker never reads the wall clock itself.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { DEFAULT_RISK_LIMITS } from '../../src/core/risk/riskEngine';
import { DailyLossTracker } from '../../src/core/risk/dailyLoss';

const DAY = 86_400_000;
// 2023-11-14T22:13:20Z — mid-day reference point.
const T = 1_700_000_000_000;

describe('DailyLossTracker', () => {
  it('accumulates only losses within the same UTC day', () => {
    const tracker = new DailyLossTracker(new MemoryStore());
    tracker.record(-100, T);
    tracker.record(+50, T + 1000); // gains do not offset the loss counter
    tracker.record(-80, T + 2000);
    expect(tracker.lossToday(T + 3000)).toBeCloseTo(180, 10);
  });

  it('pauses trading once losses reach the configured share of equity', () => {
    const tracker = new DailyLossTracker(new MemoryStore());
    const equity = 10_000;
    // Default daily loss limit: 3% -> 300.
    tracker.record(-299, T);
    expect(tracker.isPaused(T, equity, DEFAULT_RISK_LIMITS)).toBe(false);
    tracker.record(-1, T + 1000);
    expect(tracker.isPaused(T + 1000, equity, DEFAULT_RISK_LIMITS)).toBe(true);
  });

  it('gains alone never pause trading', () => {
    const tracker = new DailyLossTracker(new MemoryStore());
    tracker.record(+5_000, T);
    expect(tracker.isPaused(T, 10_000, DEFAULT_RISK_LIMITS)).toBe(false);
    expect(tracker.lossToday(T)).toBe(0);
  });

  it('resets automatically on the next UTC day', () => {
    const tracker = new DailyLossTracker(new MemoryStore());
    tracker.record(-500, T);
    expect(tracker.isPaused(T, 10_000, DEFAULT_RISK_LIMITS)).toBe(true);

    const nextDay = T + DAY;
    expect(tracker.lossToday(nextDay)).toBe(0);
    expect(tracker.isPaused(nextDay, 10_000, DEFAULT_RISK_LIMITS)).toBe(false);
    // And the new day accumulates independently.
    tracker.record(-100, nextDay);
    expect(tracker.lossToday(nextDay + 1000)).toBeCloseTo(100, 10);
  });

  it('persists across instances through the storage layer', () => {
    const store = new MemoryStore();
    new DailyLossTracker(store).record(-350, T);
    const restored = new DailyLossTracker(store);
    expect(restored.lossToday(T + 1000)).toBeCloseTo(350, 10);
    expect(restored.isPaused(T + 1000, 10_000, DEFAULT_RISK_LIMITS)).toBe(true);
  });

  it('ignores non-finite P&L values instead of corrupting state', () => {
    const tracker = new DailyLossTracker(new MemoryStore());
    tracker.record(Number.NaN, T);
    tracker.record(-Infinity, T);
    expect(tracker.lossToday(T)).toBe(0);
  });
});
