import { describe, expect, it } from 'vitest';
import { decideSentimentTrend, FNG_WINDOW, TREND_SMA_PERIOD } from '../../src/core/signal/sentimentTrend';

const rising = (n: number) => Array.from({ length: n }, (_, i) => 100 + i); // last close well above its SMA
const falling = (n: number) => Array.from({ length: n }, (_, i) => 300 - i);

describe('decideSentimentTrend (F2, frozen 2026-10-17)', () => {
  it('holds only when the 7-day sentiment average is above 50 AND price is above its 100-day SMA', () => {
    expect(decideSentimentTrend(Array(FNG_WINDOW).fill(60), rising(TREND_SMA_PERIOD + 5)).hold).toBe(true);
    expect(decideSentimentTrend(Array(FNG_WINDOW).fill(40), rising(TREND_SMA_PERIOD + 5)).hold).toBe(false); // fear
    expect(decideSentimentTrend(Array(FNG_WINDOW).fill(60), falling(TREND_SMA_PERIOD + 5)).hold).toBe(false); // downtrend
  });

  it('is strict at the threshold: an average of exactly 50 is not enough', () => {
    expect(decideSentimentTrend(Array(FNG_WINDOW).fill(50), rising(TREND_SMA_PERIOD + 5)).hold).toBe(false);
  });

  it('uses only the latest 7 sentiment readings', () => {
    const fng = [10, 10, 10, 10, 10, 10, 10, 90, 90, 90, 90, 90, 90, 90]; // old fear, recent greed
    expect(decideSentimentTrend(fng, rising(TREND_SMA_PERIOD + 5)).hold).toBe(true);
  });

  it('stays in cash (never throws) when there is not enough history', () => {
    expect(decideSentimentTrend([60, 60], rising(TREND_SMA_PERIOD + 5)).hold).toBe(false);
    expect(decideSentimentTrend(Array(FNG_WINDOW).fill(60), rising(TREND_SMA_PERIOD - 1)).hold).toBe(false);
    expect(decideSentimentTrend([], []).reason).toContain('not enough');
  });
});
