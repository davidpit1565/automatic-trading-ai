import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles, SyntheticDataSource } from '../../src/core/data/synthetic';
import { validateCandle } from '../../src/core/data/candles';

const ANCHOR = 1700000000000;

describe('generateSyntheticCandles', () => {
  it('is deterministic for the same seed', () => {
    const options = {
      seed: 42,
      startPrice: 100,
      count: 50,
      timeframe: '1h' as const,
      startTimestamp: ANCHOR,
    };
    expect(generateSyntheticCandles(options)).toEqual(generateSyntheticCandles(options));
  });

  it('differs across seeds', () => {
    const base = { startPrice: 100, count: 50, timeframe: '1h' as const, startTimestamp: ANCHOR };
    const a = generateSyntheticCandles({ ...base, seed: 1 });
    const b = generateSyntheticCandles({ ...base, seed: 2 });
    expect(a.map((c) => c.close)).not.toEqual(b.map((c) => c.close));
  });

  it('produces valid candles with evenly spaced timestamps', () => {
    const candles = generateSyntheticCandles({
      seed: 7,
      startPrice: 100,
      count: 200,
      timeframe: '1h',
      startTimestamp: ANCHOR,
      volatility: 0.05,
    });
    expect(candles).toHaveLength(200);
    candles.forEach((candle, i) => {
      expect(validateCandle(candle).ok).toBe(true);
      expect(candle.timestamp).toBe(ANCHOR + i * 3_600_000);
    });
  });

  it('chains candles: each open equals previous close', () => {
    const candles = generateSyntheticCandles({
      seed: 9,
      startPrice: 100,
      count: 20,
      timeframe: '1d',
      startTimestamp: ANCHOR,
    });
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]?.open).toBe(candles[i - 1]?.close);
    }
  });
});

describe('SyntheticDataSource', () => {
  it('serves instruments and candles for every demo symbol', async () => {
    const source = new SyntheticDataSource(ANCHOR);
    const instruments = await source.getInstruments();
    expect(instruments.ok).toBe(true);
    if (!instruments.ok) return;
    expect(instruments.value.length).toBeGreaterThanOrEqual(5);
    for (const instrument of instruments.value) {
      const candles = await source.getCandles(instrument.symbol, '1h', 100);
      expect(candles.ok).toBe(true);
      if (candles.ok) expect(candles.value).toHaveLength(100);
    }
  });
});
