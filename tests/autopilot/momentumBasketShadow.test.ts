import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { Candle } from '../../src/core/types';
import {
  MOMENTUM_BASKET_COST_RATE,
  MOMENTUM_BASKET_RULE,
  evaluateMomentumBasket,
  stepMomentumBasket,
  wilderRsi,
  type BasketTrade,
} from '../../src/core/autopilot/momentumBasketShadow';
import { assessPromotion } from '../../src/core/autopilot/promotionBar';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const bar = (i: number, close: number, spread = 0.5): Candle => ({
  timestamp: T0 + i * DAY, open: close, high: close + spread, low: close - spread, close, volume: 1,
});
/** 60 closed bars rising steadily (+1.2%/day): strong momentum, RSI high, close at the top of the range. */
const rising = (n = 60): Candle[] => Array.from({ length: n }, (_, i) => bar(i, 100 * 1.012 ** i, 0.2));
const flat = (n = 60): Candle[] => Array.from({ length: n }, (_, i) => bar(i, 100 + (i % 2 ? 0.1 : -0.1), 0.3));

describe('wilderRsi', () => {
  it('matches the study implementation (pandas ewm alpha=1/14, adjust=False)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 1.3 + 4 * Math.sin(i / 2.1));
    expect(wilderRsi(closes)).toBeCloseTo(94.086831, 4);
  });
  it('needs enough history and handles a flat series', () => {
    expect(wilderRsi([1, 2, 3])).toBeNull();
    expect(wilderRsi(Array(30).fill(5))).toBeNull();
  });
});

describe('evaluateMomentumBasket (frozen rule)', () => {
  it('qualifies a strong steady riser and rejects a flat series', () => {
    const s = evaluateMomentumBasket(rising())!;
    expect(s.qualifies).toBe(true);
    expect(s.mom30).toBeGreaterThanOrEqual(MOMENTUM_BASKET_RULE.mom30Min);
    expect(evaluateMomentumBasket(flat())!.qualifies).toBe(false);
  });
  it('returns null with too little history', () => {
    expect(evaluateMomentumBasket(rising(20))).toBeNull();
  });
  it('rejects a coin that rose hard but has already fallen back inside its range', () => {
    const bars = rising(55);
    for (let i = 55; i < 60; i++) bars.push(bar(i, bars[54]!.close * (1 - 0.03 * (i - 54)), 0.2));
    expect(evaluateMomentumBasket(bars)!.qualifies).toBe(false);
  });
});

function input(day: number, markets: Record<string, { closed: Candle[]; open: number }>, extra = {}) {
  const dayStart = T0 + 60 * DAY + day * DAY;
  return {
    day: new Date(dayStart).toISOString().slice(0, 10),
    dayStart,
    markets: Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, { closed: v.closed, todayOpen: v.open, markPrice: v.open }])),
    initialCash: 10_000,
    ...extra,
  };
}

describe('stepMomentumBasket', () => {
  it('enters a qualifying coin at the open with a fixed slot and both-side costs, then exits after the hold period', () => {
    const store = new MemoryStore();
    const first = stepMomentumBasket(store, input(0, { AAA: { closed: rising(), open: 200 }, BBB: { closed: flat(), open: 100 } }));
    expect(first.entriesToday).toEqual(['AAA']);
    expect(first.openPositions).toEqual(['AAA']);
    // slot = 10_000 / (5 * 1.002) notional, + 0.2% entry fee out of cash
    const slot = 10_000 / (MOMENTUM_BASKET_RULE.maxPositions * (1 + MOMENTUM_BASKET_COST_RATE));
    expect(first.equity).toBeCloseTo(10_000 - slot * MOMENTUM_BASKET_COST_RATE, 6);

    const mid = stepMomentumBasket(store, input(3, { AAA: { closed: rising(), open: 210 } }));
    expect(mid.exitsToday).toEqual([]);

    const last = stepMomentumBasket(store, input(7, { AAA: { closed: [], open: 220 } }));
    expect(last.exitsToday).toEqual(['AAA']);
    expect(last.openPositions).toEqual([]);
    const journal = store.get<BasketTrade[]>('trade-journal')!;
    expect(journal).toHaveLength(1);
    // slot notional at 200 -> slot/200 units; exit at 220; fees = both sides
    const units = slot / 200;
    const verdict = assessPromotion(journal, 10_000);
    expect(verdict.totalNetPnl).toBeCloseTo(units * 20 - (slot * 0.002 + units * 220 * 0.002), 6);
    expect(last.equity).toBeCloseTo(10_000 + verdict.totalNetPnl, 6);
  });

  it('is idempotent within a UTC day', () => {
    const store = new MemoryStore();
    const a = stepMomentumBasket(store, input(0, { AAA: { closed: rising(), open: 200 } }));
    const b = stepMomentumBasket(store, input(0, { AAA: { closed: rising(), open: 200 } }));
    expect(b.entriesToday).toEqual([]);
    expect(b.equity).toBeCloseTo(a.equity, 8);
    expect(store.get<unknown[]>('trade-journal')).toEqual([]);
  });

  it('never exceeds max positions, picks the strongest momentum, and respects entry-paused symbols', () => {
    const store = new MemoryStore();
    const markets: Record<string, { closed: Candle[]; open: number }> = {};
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((s, i) => {
      markets[s] = { closed: Array.from({ length: 60 }, (_, k) => bar(k, 100 * (1.010 + i * 0.001) ** k, 0.2)), open: 150 };
    });
    const r = stepMomentumBasket(store, input(0, markets, { entryPaused: new Set(['G']) }));
    expect(r.openPositions).toHaveLength(MOMENTUM_BASKET_RULE.maxPositions);
    expect(r.openPositions).not.toContain('G');
    expect(r.entriesToday[0]).toBe('F'); // strongest unpaused
  });

  it('retries an exit tomorrow when today has no price for the held symbol', () => {
    const store = new MemoryStore();
    stepMomentumBasket(store, input(0, { AAA: { closed: rising(), open: 200 } }));
    const noPrice = stepMomentumBasket(store, input(7, { BBB: { closed: flat(), open: 100 } }));
    expect(noPrice.openPositions).toEqual(['AAA']);
    const next = stepMomentumBasket(store, input(8, { AAA: { closed: [], open: 205 } }));
    expect(next.exitsToday).toEqual(['AAA']);
  });
});
