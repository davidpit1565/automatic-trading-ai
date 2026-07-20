import { describe, expect, it } from 'vitest';
import { buildDailyRegimeFilter } from '../../src/core/signal/regimeFilter';
import type { Candle } from '../../src/core/types';

const DAY_MS = 86_400_000;
const D0 = 1_700_000_000_000; // arbitrary daily-aligned anchor

function daily(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: D0 + i * DAY_MS,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe('buildDailyRegimeFilter', () => {
  it('allows longs once price is clearly above the daily EMA (uptrend)', () => {
    const candles = daily([10, 11, 12, 13, 14, 16, 18, 20, 23, 26]);
    const allowed = buildDailyRegimeFilter(candles, { period: 3 });
    // Well after the daily bars have closed, in a clear uptrend.
    expect(allowed(D0 + 9 * DAY_MS + 1)).toBe(true);
  });

  it('blocks longs when price is below the daily EMA (downtrend/chop)', () => {
    const candles = daily([26, 23, 20, 18, 16, 14, 13, 12, 11, 10]);
    const allowed = buildDailyRegimeFilter(candles, { period: 3 });
    expect(allowed(D0 + 9 * DAY_MS + 1)).toBe(false);
  });

  it('never uses the still-forming "today" bar (no look-ahead)', () => {
    // Uptrend through day 8, then a sharp drop on the LAST (still-forming) bar.
    const candles = daily([10, 11, 12, 13, 14, 16, 18, 20, 23, 1]);
    const allowed = buildDailyRegimeFilter(candles, { period: 3 });
    // A timestamp inside the last bar's still-forming day must ignore it —
    // the decision should reflect the uptrend through day 8, not the crash.
    const duringLastBar = D0 + 9 * DAY_MS + 1000; // 1s into the last day
    expect(allowed(duringLastBar)).toBe(true);
  });

  it('fails open (never blocks) before there is enough daily history', () => {
    const candles = daily([10, 9, 8]); // period 200 never warms up
    const allowed = buildDailyRegimeFilter(candles, { period: 200 });
    expect(allowed(D0 + 2 * DAY_MS + DAY_MS)).toBe(true);
  });

  it('fails open when no daily bar has closed yet at all', () => {
    const candles = daily([10, 9, 8]);
    const allowed = buildDailyRegimeFilter(candles, { period: 3 });
    expect(allowed(D0 - 1)).toBe(true); // before the very first bar even opened
  });
});
