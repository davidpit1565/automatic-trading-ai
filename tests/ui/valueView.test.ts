/**
 * Pure-function tests for the Portfolio value chart's bucketing.
 *
 * Root-caused bug: 'All'/'1Y' used a fixed weekly bucket width. With real
 * live data (equity tracking only ~5 days old), that flattened the WHOLE
 * history into 1-2 candles — a chart that looks broken even though the
 * underlying data is fine. `adaptiveBucketMs` shrinks the bucket toward the
 * actual data span so short histories still show real structure, while
 * long histories keep the original nice round bucket widths.
 */
import { describe, expect, it } from 'vitest';
import { adaptiveBucketMs, bucketize } from '../../src/ui/views/valueView';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEK = 7 * DAY;

describe('adaptiveBucketMs', () => {
  it('shrinks a too-wide bucket down when the data span is short (the real bug)', () => {
    // ~5 days of history against a weekly (7-day) "nice" bucket for All/1Y.
    const spanMs = 5 * DAY + 3 * HOUR;
    const bucketMs = adaptiveBucketMs(spanMs, WEEK);
    expect(bucketMs).toBeLessThan(WEEK);
    // Should yield close to the ~30-candle target, not 1-2 giant candles.
    expect(spanMs / bucketMs).toBeGreaterThan(20);
  });

  it('keeps the nice bucket width once there is plenty of history', () => {
    const spanMs = 400 * DAY; // well over a year
    expect(adaptiveBucketMs(spanMs, WEEK)).toBe(WEEK);
  });

  it('never goes below the floor even for a near-zero span', () => {
    expect(adaptiveBucketMs(60_000, WEEK)).toBe(5 * 60_000);
  });

  it('returns the nice width unchanged for a zero or negative span', () => {
    expect(adaptiveBucketMs(0, HOUR)).toBe(HOUR);
    expect(adaptiveBucketMs(-1, HOUR)).toBe(HOUR);
  });
});

describe('bucketize', () => {
  it('aggregates real OHLC (open=first, high=max, low=min, close=last) per bucket', () => {
    const t0 = 1_700_000_000_000;
    const points = [
      { at: t0, equity: 100 },
      { at: t0 + 10 * 60_000, equity: 110 },
      { at: t0 + 20 * 60_000, equity: 90 },
      { at: t0 + HOUR + 5 * 60_000, equity: 95 }, // next hour bucket
    ];
    const candles = bucketize(points, HOUR);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 90, close: 90 });
    expect(candles[1]).toMatchObject({ open: 95, high: 95, low: 95, close: 95 });
  });
});
