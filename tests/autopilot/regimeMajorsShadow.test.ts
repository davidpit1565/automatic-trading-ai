import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { Candle } from '../../src/core/types';
import {
  REGIME_MAJORS_BAR,
  REGIME_MAJORS_COST_RATE,
  REGIME_MAJORS_RULE,
  assessRegimeMajors,
  evaluateRegime,
  stepRegimeMajors,
  type RegimeTrade,
} from '../../src/core/autopilot/regimeMajorsShadow';
import { netPnl } from '../../src/core/autopilot/promotionBar';

const DAY = 86_400_000;
const T0 = Date.parse('2026-08-01T00:00:00Z');
const bar = (i: number, close: number, low = close * 0.99): Candle => ({
  timestamp: T0 + i * DAY, open: close, high: close * 1.01, low, close, volume: 1,
});
/** n closed bars, flat at 100 then a final jump so that the 30-day return is `ret`. */
const btcBars = (ret: number, n = 40): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i, i === n - 1 ? 100 * (1 + ret) : 100));
const flatBars = (price: number, n = 40): Candle[] => Array.from({ length: n }, (_, i) => bar(i, price));

const START = T0 + 40 * DAY;
function input(dayOffset: number, btc: Candle[], eth: Candle[], opens = { btc: 100, eth: 50 }) {
  const dayStart = START + dayOffset * DAY;
  return {
    day: new Date(dayStart).toISOString().slice(0, 10),
    dayStart,
    markets: {
      XBTEUR: { closed: btc, todayOpen: opens.btc, markPrice: opens.btc },
      ETHEUR: { closed: eth, todayOpen: opens.eth, markPrice: opens.eth },
    },
    initialCash: 10_000,
  };
}

describe('evaluateRegime', () => {
  it('is on at exactly the frozen threshold and off just below it', () => {
    expect(evaluateRegime(btcBars(REGIME_MAJORS_RULE.btcMom30Min + 1e-9))!.on).toBe(true);
    expect(evaluateRegime(btcBars(REGIME_MAJORS_RULE.btcMom30Min - 0.01))!.on).toBe(false);
  });
  it('returns null with too little history', () => {
    expect(evaluateRegime(btcBars(0.3, 20))).toBeNull();
  });
});

describe('stepRegimeMajors', () => {
  it('does nothing while the regime is off', () => {
    const store = new MemoryStore();
    const s = stepRegimeMajors(store, input(0, btcBars(0.05), flatBars(50)));
    expect(s.openLegs).toEqual([]);
    expect(s.regimeOn).toBe(false);
    expect(s.equity).toBeCloseTo(10_000, 6);
  });

  it('enters BTC and ETH equally (30% sleeve), holds 7 days, then exits at the open', () => {
    const store = new MemoryStore();
    const on = btcBars(0.3);
    const e = stepRegimeMajors(store, input(0, on, flatBars(50)));
    expect(e.entriesToday).toEqual(['XBTEUR', 'ETHEUR']);
    // 3,000 deployed incl. fees: 2 legs x 1,500/(1+c) of value
    const deployed = 10_000 - (store.get<{ cash: number }>('state')!.cash);
    expect(deployed).toBeCloseTo(3_000, 6);
    // day 3: still held (idempotent same-day call changes nothing)
    stepRegimeMajors(store, input(3, on, flatBars(50), { btc: 104, eth: 52 }));
    expect(store.get<{ positions: unknown[] }>('state')!.positions).toHaveLength(2);
    stepRegimeMajors(store, input(3, on, flatBars(50), { btc: 150, eth: 90 })); // same day: no-op
    expect(store.get<{ positions: unknown[] }>('state')!.positions).toHaveLength(2);
    // day 7: time exit at the open
    const x = stepRegimeMajors(store, input(7, flatBars(100), flatBars(50), { btc: 110, eth: 55 }));
    expect(x.exitsToday).toEqual(['XBTEUR', 'ETHEUR']);
    const j = store.get<RegimeTrade[]>('trade-journal')!;
    expect(j.every((t) => t.exitReason === 'time-exit')).toBe(true);
    const cost = REGIME_MAJORS_COST_RATE;
    // +10% on both legs, costs both sides: net ~ 2000/(1+c) * (1.1*(1-c) - (1+c))
    const expected = 2 * ((1_500 / (1 + cost)) * (1.1 * (1 - cost) - (1 + cost)));
    expect(j.reduce((s, t) => s + netPnl(t), 0)).toBeCloseTo(expected, 4);
    expect(x.windows).toBe(1);
  });

  it('exits on the disaster stop (lows since entry) at stop minus slippage', () => {
    const store = new MemoryStore();
    stepRegimeMajors(store, input(0, btcBars(0.3), flatBars(50)));
    // BTC bar since entry dips 20% below the entry price of 100 -> stop (85) is hit
    const crash = [...btcBars(0.3), { ...bar(40, 90), timestamp: START, low: 80 }];
    const x = stepRegimeMajors(store, input(1, crash, flatBars(50)));
    const j = store.get<RegimeTrade[]>('trade-journal')!;
    const btc = j.find((t) => t.symbol === 'XBTEUR')!;
    expect(btc.exitReason).toBe('stop-loss');
    expect(btc.exitPrice).toBeCloseTo(100 * (1 - REGIME_MAJORS_RULE.stopFraction - REGIME_MAJORS_RULE.stopSlippage), 9);
    expect(x.exitsToday).toContain('XBTEUR');
  });

  it('a stop that gaps through its level is booked at the gap, never better than the stop fill', () => {
    const store = new MemoryStore();
    stepRegimeMajors(store, input(0, btcBars(0.3), flatBars(50)));
    const crash = [...btcBars(0.3), { ...bar(40, 70), timestamp: START, low: 60 }];
    stepRegimeMajors(store, input(1, crash, flatBars(50), { btc: 70, eth: 50 }));
    const btc = store.get<RegimeTrade[]>('trade-journal')!.find((t) => t.symbol === 'XBTEUR')!;
    expect(btc.exitPrice).toBe(70); // next open is below the stop level (84.5)
  });

  it('after BOTH legs are stopped the window stays over until day 7 (no same-day re-entry)', () => {
    const store = new MemoryStore();
    const on = btcBars(0.3);
    stepRegimeMajors(store, input(0, on, flatBars(50)));
    // both legs trade 20%+ below entry on a closed bar since entry; BTC's 30-day regime is still on
    const crashB = [...on, { ...bar(40, 125), timestamp: START, low: 80 }];
    const crashE = [...flatBars(50), { ...bar(40, 45), timestamp: START, low: 38 }];
    const x = stepRegimeMajors(store, input(1, crashB, crashE));
    expect(x.exitsToday).toEqual(['XBTEUR', 'ETHEUR']);
    expect(x.entriesToday).toEqual([]);
    expect(x.openLegs).toEqual([]);
    // still blocked on day 6 with the regime on; free again on day 7
    expect(stepRegimeMajors(store, input(6, on, flatBars(50))).entriesToday).toEqual([]);
    expect(stepRegimeMajors(store, input(7, on, flatBars(50))).entriesToday).toEqual(['XBTEUR', 'ETHEUR']);
  });

  it('accumulates the always-on control from bars that matured 7 days after each day since the start', () => {
    const store = new MemoryStore();
    // bars 40.. are the forward period; BTC opens 100 on day 0 and 110 on day 7 (+10% gross), flat before
    const withOpens = (opens: Record<number, number>): Candle[] =>
      Array.from({ length: 47 }, (_, i) => ({ ...bar(i, 100), open: opens[i] ?? 100 }));
    let last: ReturnType<typeof stepRegimeMajors> | undefined;
    for (let d = 0; d <= 8; d++) {
      const btcClosed = withOpens({ 47: 110 }).slice(0, 40 + d);
      const ethClosed = flatBars(50, 40 + d);
      last = stepRegimeMajors(store, input(d, btcClosed, ethClosed, { btc: d >= 7 ? 110 : 100, eth: 50 }));
    }
    expect(last!.unconditionalDays).toBeGreaterThan(0);
    expect(last!.unconditionalMean).not.toBeNull();
  });

  it('refuses to enter when a leg has no current price (fail safe)', () => {
    const store = new MemoryStore();
    const i = input(0, btcBars(0.3), flatBars(50), { btc: 100, eth: 0 });
    expect(stepRegimeMajors(store, i).openLegs).toEqual([]);
  });

  it('does not restart a window while one is open, but restarts the day it ends', () => {
    const store = new MemoryStore();
    const on = btcBars(0.3);
    stepRegimeMajors(store, input(0, on, flatBars(50)));
    stepRegimeMajors(store, input(2, on, flatBars(50)));
    expect(store.get<{ positions: { entryTimestamp: number }[] }>('state')!.positions.every((p) => p.entryTimestamp === START)).toBe(true);
    const x = stepRegimeMajors(store, input(7, on, flatBars(50)));
    expect(x.exitsToday).toHaveLength(2);
    expect(x.entriesToday).toHaveLength(2);
  });
});

describe('frozen constants (pre-commitment for the forward test)', () => {
  it('the rule and the bar are exactly the frozen 2026-10-23 values: changing any of them needs a dated PROJECT_STATE entry', () => {
    expect(REGIME_MAJORS_RULE).toEqual({
      btcMom30Min: 0.219, lookbackDays: 30, holdDays: 7, sleeveFraction: 0.3, stopFraction: 0.15,
      stopSlippage: 0.005, regimeSymbol: 'XBTEUR', legs: ['XBTEUR', 'ETHEUR'],
    });
    expect(REGIME_MAJORS_COST_RATE).toBe(0.003);
    expect(REGIME_MAJORS_BAR).toEqual({
      abort: { minWindows: 12, meanAtOrBelow: -0.01, consecutiveBad: 3, badWindow: -0.08, accountDrawdownPct: 15 },
      pass: {
        minWindows: 12, minMonths: 6, meanAtLeast: 0.01, winRateAtLeast: 0.55, worstWindowAbove: -0.2,
        minExcessOverUnconditional: 0.015, minUnconditionalDays: 90,
      },
      reviewAfterMonths: 24,
    });
  });
});

describe('assessRegimeMajors (pre-committed bar)', () => {
  const win = (i: number, ret: number): RegimeTrade[] =>
    ['XBTEUR', 'ETHEUR'].map((symbol) => ({
      id: `${symbol}:${i}`, symbol,
      entryTimestamp: T0 + i * 10 * DAY, exitTimestamp: T0 + i * 10 * DAY + 7 * DAY,
      entryPrice: 100, exitPrice: 100 * (1 + ret), positionSize: 10, fees: 0,
      exitReason: 'time-exit' as const, returnPct: ret * 100,
    }));
  const journal = (rets: number[]): RegimeTrade[] => rets.flatMap((r, i) => win(i, r));
  const good = [0.03, 0.05, -0.02, 0.04, 0.06, 0.02, 0.05, 0.03, -0.01, 0.07, 0.04, 0.05, 0.03, 0.02];

  it('continues (never passes) with too few windows', () => {
    const v = assessRegimeMajors(journal([0.03, 0.04, 0.02]), 10_000);
    expect(v.status).toBe('continue');
    expect(v.reasons.join(' ')).toMatch(/windows/);
  });

  it('aborts on a bad mean after the minimum number of windows', () => {
    const v = assessRegimeMajors(journal(Array(REGIME_MAJORS_BAR.abort.minWindows).fill(-0.02)), 10_000);
    expect(v.status).toBe('abort');
  });

  it('aborts after three consecutive disasters even with few windows', () => {
    const v = assessRegimeMajors(journal([0.05, -0.1, -0.1, -0.09]), 10_000);
    expect(v.status).toBe('abort');
  });

  it('aborts at the project drawdown line (15%), not a looser one', () => {
    // one window of -5% on a 28,000 sleeve loses 1,400 = 14.0% of 10,000: not yet; on 31,000 it loses 15.5%: abort
    const at = (size: number) => journal([-0.05]).map((t) => ({ ...t, positionSize: size }));
    expect(assessRegimeMajors(at(140), 10_000).status).toBe('continue');
    expect(assessRegimeMajors(at(155), 10_000).status).toBe('abort');
  });

  it('reaches pass-pending-control without a control, and passes only with a control that is beaten', () => {
    const j = good.flatMap((r, i) => win(i * 2, r)); // windows spread over > 6 months
    expect(assessRegimeMajors(j, 10_000).status).toBe('pass-pending-control');
    expect(assessRegimeMajors(j, 10_000, { unconditionalMean: 0.005, unconditionalDays: 120 }).status).toBe('pass');
    expect(assessRegimeMajors(j, 10_000, { unconditionalMean: 0.03, unconditionalDays: 120 }).status).toBe('continue');
    // a control with too few matured days does not count
    expect(assessRegimeMajors(j, 10_000, { unconditionalMean: 0.005, unconditionalDays: 20 }).status).toBe('pass-pending-control');
  });

  it('inherits the project bar: a window set with profit factor under 1.3 cannot pass', () => {
    const weak = [0.01, 0.012, -0.03, 0.011, 0.012, -0.03, 0.013, 0.012, -0.02, 0.011, 0.012, 0.011, 0.012, -0.001];
    const v = assessRegimeMajors(weak.flatMap((r, i) => win(i * 2, r)), 10_000, { unconditionalMean: 0, unconditionalDays: 200 });
    expect(v.status).toBe('continue');
  });

  it('the worst-window limit can fail (fills may be worse than the stop level)', () => {
    const bad = [...good.slice(0, 13), -0.19, 0.2];
    const v = assessRegimeMajors(bad.flatMap((r, i) => win(i * 2, r)), 10_000, { unconditionalMean: 0, unconditionalDays: 200 });
    expect(v.reasons.join(' ')).not.toMatch(/a window lost more/); // -19% is inside the -20% design limit
    const worse = [...good.slice(0, 13), -0.21, 0.25];
    const w = assessRegimeMajors(worse.flatMap((r, i) => win(i * 2, r)), 10_000, { unconditionalMean: 0, unconditionalDays: 200 });
    expect(w.status === 'continue' && w.reasons.join(' ')).toMatch(/a window lost more/);
  });

  it('declares itself inconclusive after 24 months with too few windows, instead of waiting for ever', () => {
    const j = journal([0.04, -0.01, 0.03]);
    const started = T0;
    expect(assessRegimeMajors(j, 10_000, { startedAt: started, now: started + 400 * DAY }).status).toBe('continue');
    expect(assessRegimeMajors(j, 10_000, { startedAt: started, now: started + 740 * DAY }).status).toBe('inconclusive');
  });
});
