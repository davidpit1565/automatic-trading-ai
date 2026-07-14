import { describe, expect, it } from 'vitest';
import { obv, relativeVolume, volumeSma } from '../../src/core/indicators';
import { candlesWithVolume } from '../helpers';

describe('volumeSma', () => {
  it('averages volume over the window', () => {
    const candles = candlesWithVolume([
      [10, 100],
      [11, 200],
      [12, 300],
      [13, 400],
    ]);
    expect(volumeSma(candles, 3)).toEqual([null, null, 200, 300]);
  });
});

describe('relativeVolume', () => {
  it('is the ratio of current volume to its rolling average', () => {
    const candles = candlesWithVolume([
      [10, 100],
      [11, 100],
      [12, 100],
      [13, 400], // avg of last 3 = 200, rel = 2
    ]);
    const out = relativeVolume(candles, 3);
    expect(out[2]).toBeCloseTo(1, 10);
    expect(out[3]).toBeCloseTo(2, 10);
  });

  it('is null while warming up or when average volume is zero', () => {
    const zero = candlesWithVolume([
      [10, 0],
      [11, 0],
      [12, 0],
    ]);
    expect(relativeVolume(zero, 3)[2]).toBeNull();
  });
});

describe('obv', () => {
  it('accumulates signed volume by close direction', () => {
    const candles = candlesWithVolume([
      [10, 100],
      [11, 200], // up: +200
      [10, 300], // down: -300 -> -100
      [10, 400], // flat: unchanged
      [12, 500], // up: +500 -> 400
    ]);
    expect(obv(candles)).toEqual([0, 200, -100, -100, 400]);
  });

  it('returns [0] for a single candle and [] for empty input', () => {
    expect(obv(candlesWithVolume([[10, 100]]))).toEqual([0]);
    expect(obv([])).toEqual([]);
  });
});
