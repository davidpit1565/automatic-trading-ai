import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { stepSentimentShadow, SENTIMENT_SHADOW_COST_RATE } from '../../src/core/autopilot/sentimentShadow';
import { FNG_WINDOW, TREND_SMA_PERIOD } from '../../src/core/signal/sentimentTrend';

const up = Array.from({ length: TREND_SMA_PERIOD + 5 }, (_, i) => 100 + i);
const down = Array.from({ length: TREND_SMA_PERIOD + 5 }, (_, i) => 300 - i);
const greed = Array(FNG_WINDOW).fill(70);
const fear = Array(FNG_WINDOW).fill(30);
const base = { initialCash: 1000, markPrice: 100 };

describe('stepSentimentShadow (F2 paper forward test)', () => {
  it('buys at the day open on a hold signal, charging the per-side cost, and sells on cash', () => {
    const store = new MemoryStore();
    const a = stepSentimentShadow(store, { ...base, day: '2026-10-18', fng: greed, closes: up, todayOpen: 100, markPrice: 100 });
    expect(a.inPosition).toBe(true);
    expect(a.equity).toBeCloseTo(1000 * (1 - SENTIMENT_SHADOW_COST_RATE), 6); // only the entry cost so far
    const b = stepSentimentShadow(store, { ...base, day: '2026-10-19', fng: fear, closes: up, todayOpen: 110, markPrice: 110 });
    expect(b.inPosition).toBe(false);
    expect(b.trades).toBe(1);
    // +10% price move minus both sides' costs.
    expect(b.equity).toBeCloseTo(1000 * (1 - 0.0019) * 1.1 * (1 - 0.0019), 6);
    expect(b.winRatePct).toBe(100);
  });

  it('is idempotent within a UTC day: a second call only re-marks and never trades again', () => {
    const store = new MemoryStore();
    stepSentimentShadow(store, { ...base, day: '2026-10-18', fng: greed, closes: up, todayOpen: 100, markPrice: 100 });
    const again = stepSentimentShadow(store, { ...base, day: '2026-10-18', fng: fear, closes: down, todayOpen: 100, markPrice: 105 });
    expect(again.inPosition).toBe(true); // the contradicting inputs are ignored until tomorrow
    expect(again.trades).toBe(0);
    expect(again.equity).toBeCloseTo((1000 * (1 - 0.0019) / 100) * 105, 6);
  });

  it('stays flat in cash and reports BTC buy&hold from the same start for comparison', () => {
    const store = new MemoryStore();
    stepSentimentShadow(store, { ...base, day: '2026-10-18', fng: fear, closes: down, todayOpen: 100, markPrice: 100 });
    const s = stepSentimentShadow(store, { ...base, day: '2026-10-19', fng: fear, closes: down, todayOpen: 90, markPrice: 90 });
    expect(s.inPosition).toBe(false);
    expect(s.equity).toBe(1000);
    expect(s.returnPct).toBe(0);
    expect(s.btcReturnPct).toBeCloseTo(-10, 6);
  });

  it('persists state across instances of the same store', () => {
    const store = new MemoryStore();
    stepSentimentShadow(store, { ...base, day: '2026-10-18', fng: greed, closes: up, todayOpen: 100, markPrice: 100 });
    const s = stepSentimentShadow(store, { ...base, day: '2026-10-19', fng: greed, closes: up, todayOpen: 120, markPrice: 120 });
    expect(s.startedAt).toBe('2026-10-18');
    expect(s.inPosition).toBe(true);
    expect(s.btcReturnPct).toBeCloseTo(20, 6);
  });
});
