/**
 * Scheduler abstraction tests (TDD).
 *
 * Business logic never touches timers directly: the monitoring engine
 * receives a Scheduler. IntervalScheduler wraps real timers; ManualScheduler
 * drives ticks deterministically in tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IntervalScheduler,
  ManualScheduler,
  MONITOR_INTERVALS,
  type MonitorInterval,
} from '../../src/core/monitor/scheduler';

describe('MONITOR_INTERVALS', () => {
  it('supports the required intervals with correct durations', () => {
    const expected: Record<MonitorInterval, number> = {
      '5m': 300_000,
      '15m': 900_000,
      '30m': 1_800_000,
      '1h': 3_600_000,
      '4h': 14_400_000,
      '1d': 86_400_000,
    };
    expect(MONITOR_INTERVALS).toEqual(expected);
  });
});

describe('ManualScheduler', () => {
  it('fires the task only on explicit ticks', async () => {
    const scheduler = new ManualScheduler();
    let runs = 0;
    scheduler.start(60_000, () => {
      runs++;
    });
    expect(scheduler.isRunning()).toBe(true);
    expect(runs).toBe(0);
    await scheduler.tick();
    await scheduler.tick();
    expect(runs).toBe(2);
  });

  it('stops firing after stop() and reports intervalMs while running', async () => {
    const scheduler = new ManualScheduler();
    let runs = 0;
    scheduler.start(300_000, () => {
      runs++;
    });
    expect(scheduler.intervalMs()).toBe(300_000);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.intervalMs()).toBeNull();
    await scheduler.tick(); // no task registered any more
    expect(runs).toBe(0);
  });
});

describe('IntervalScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires repeatedly at the configured interval', () => {
    const scheduler = new IntervalScheduler();
    let runs = 0;
    scheduler.start(60_000, () => {
      runs++;
    });
    vi.advanceTimersByTime(180_000);
    expect(runs).toBe(3);
    scheduler.stop();
    vi.advanceTimersByTime(120_000);
    expect(runs).toBe(3);
  });

  it('restarting replaces the previous schedule instead of stacking', () => {
    const scheduler = new IntervalScheduler();
    let runs = 0;
    scheduler.start(60_000, () => {
      runs++;
    });
    scheduler.start(120_000, () => {
      runs++;
    });
    vi.advanceTimersByTime(120_000);
    expect(runs).toBe(1); // only the second schedule is live
  });

  it('rejects non-positive intervals', () => {
    const scheduler = new IntervalScheduler();
    expect(() => scheduler.start(0, () => {})).toThrow(RangeError);
  });
});
