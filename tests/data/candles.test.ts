import { describe, expect, it } from 'vitest';
import { parseCandle, parseCandleSeries, validateCandle } from '../../src/core/data/candles';

describe('parseCandle', () => {
  it('parses array form [ts, o, h, l, c, v]', () => {
    const result = parseCandle([1700000000000, 100, 110, 95, 105, 1234]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        timestamp: 1700000000000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1234,
      });
    }
  });

  it('converts epoch seconds to milliseconds', () => {
    const result = parseCandle([1700000000, 1, 2, 0.5, 1.5, 10]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timestamp).toBe(1700000000000);
  });

  it('parses object form with long keys', () => {
    const result = parseCandle({
      timestamp: 1700000000000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 500,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.close).toBe(11);
  });

  it('parses object form with short keys and numeric strings', () => {
    const result = parseCandle({ t: '1700000000', o: '10', h: '12', l: '9', c: '11', v: '3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timestamp).toBe(1700000000000);
      expect(result.value.volume).toBe(3);
    }
  });

  it('defaults missing volume to 0 in object form', () => {
    const result = parseCandle({ timestamp: 1700000000000, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.volume).toBe(0);
  });

  it('rejects short arrays', () => {
    const result = parseCandle([1700000000000, 1, 2]);
    expect(result.ok).toBe(false);
  });

  it('rejects non-numeric values', () => {
    const result = parseCandle([1700000000000, 'abc', 2, 0.5, 1.5, 10]);
    expect(result.ok).toBe(false);
  });

  it('rejects candles violating OHLC invariants', () => {
    // high below close
    expect(parseCandle([1700000000000, 100, 101, 95, 105, 10]).ok).toBe(false);
    // low above open
    expect(parseCandle([1700000000000, 100, 110, 102, 105, 10]).ok).toBe(false);
    // negative volume
    expect(parseCandle([1700000000000, 100, 110, 95, 105, -1]).ok).toBe(false);
  });

  it('rejects unsupported payload types', () => {
    expect(parseCandle('nope').ok).toBe(false);
    expect(parseCandle(null).ok).toBe(false);
  });
});

describe('validateCandle', () => {
  it('accepts a valid candle', () => {
    const candle = { timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 };
    expect(validateCandle(candle).ok).toBe(true);
  });

  it('rejects non-positive timestamps and negative prices', () => {
    expect(validateCandle({ timestamp: 0, open: 1, high: 1, low: 1, close: 1, volume: 0 }).ok).toBe(false);
    expect(validateCandle({ timestamp: 1, open: -1, high: 1, low: -1, close: 1, volume: 0 }).ok).toBe(false);
  });
});

describe('parseCandleSeries', () => {
  it('sorts ascending, de-duplicates by timestamp, and reports rejects', () => {
    const { candles, rejected } = parseCandleSeries([
      [3000_000_000_000, 10, 11, 9, 10.5, 5],
      [1000_000_000_000, 10, 11, 9, 10.5, 5],
      [1000_000_000_000, 10, 11, 9, 10.4, 5], // duplicate timestamp, last wins
      [2000_000_000_000, 10, 9, 9, 10.5, 5], // invalid: high < open
      'garbage',
    ]);
    expect(candles.map((c) => c.timestamp)).toEqual([1000_000_000_000, 3000_000_000_000]);
    expect(candles[0]?.close).toBe(10.4);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.index)).toEqual([3, 4]);
  });

  it('returns empty series for empty input', () => {
    const { candles, rejected } = parseCandleSeries([]);
    expect(candles).toEqual([]);
    expect(rejected).toEqual([]);
  });
});
