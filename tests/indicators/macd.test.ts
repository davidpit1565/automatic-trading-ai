import { describe, expect, it } from 'vitest';
import { ema, macd } from '../../src/core/indicators';

describe('macd', () => {
  it('macd line equals EMA(fast) - EMA(slow) where both are defined', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 5);
    const { macd: line } = macd(values, 12, 26, 9);
    const fast = ema(values, 12);
    const slow = ema(values, 26);
    for (let i = 0; i < values.length; i++) {
      if (slow[i] === null) {
        expect(line[i]).toBeNull();
      } else {
        expect(line[i]).toBeCloseTo(fast[i]! - slow[i]!, 10);
      }
    }
  });

  it('histogram equals macd - signal where defined', () => {
    const values = Array.from({ length: 80 }, (_, i) => 50 + i * 0.5 + Math.cos(i) * 2);
    const { macd: line, signal, histogram } = macd(values);
    for (let i = 0; i < values.length; i++) {
      if (signal[i] !== null) {
        expect(histogram[i]).toBeCloseTo(line[i]! - signal[i]!, 10);
      } else {
        expect(histogram[i]).toBeNull();
      }
    }
  });

  it('signal warm-up: first signal at slowPeriod + signalPeriod - 2', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { signal } = macd(values, 12, 26, 9);
    const firstIndex = signal.findIndex((v) => v !== null);
    expect(firstIndex).toBe(26 - 1 + 9 - 1); // 33
  });

  it('is zero for a constant series', () => {
    const { macd: line, histogram } = macd(Array(60).fill(100), 12, 26, 9);
    expect(line[59]).toBeCloseTo(0, 10);
    expect(histogram[59]).toBeCloseTo(0, 10);
  });

  it('is positive in a sustained uptrend', () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 * Math.pow(1.01, i));
    const { macd: line, histogram } = macd(values);
    expect(line[79]!).toBeGreaterThan(0);
    expect(histogram[79]!).toBeGreaterThan(0);
  });

  it('rejects fastPeriod >= slowPeriod', () => {
    expect(() => macd([1, 2, 3], 26, 12, 9)).toThrow(RangeError);
    expect(() => macd([1, 2, 3], 12, 12, 9)).toThrow(RangeError);
  });
});
