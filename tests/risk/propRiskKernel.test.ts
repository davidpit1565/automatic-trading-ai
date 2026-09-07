import { describe, expect, it } from 'vitest';
import {
  evaluatePropRun,
  feesForBar,
  tradingDayKey,
  worstDailyDrawdownPct,
  type PropBar,
  type PropRulesetConfig,
} from '../../src/core/risk/propRiskKernel';

/** 1h apart, starting at an arbitrary UTC midnight so day-boundary math is easy to hand-check. */
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00:00Z
const HOUR = 3_600_000;
const bar = (i: number, overrides: Partial<PropBar> = {}): PropBar => ({
  timestamp: T0 + i * HOUR,
  equityLow: 10_000,
  equityHigh: 10_000,
  equityClose: 10_000,
  feesThisBar: 0,
  ...overrides,
});

const baseConfig: PropRulesetConfig = {
  name: 'test',
  profitTargetPct: 10,
  maxDailyLossPct: 90, // loose by default so a test can isolate the static floor
  maxDrawdownPct: 6,
  dailyResetHourUtc: 0,
};

describe('evaluatePropRun', () => {
  it('breaches on the static floor: initialBalance 10000, maxDrawdownPct 6 -> floor 9400', () => {
    // staticFloor = 10000 * (1 - 6/100) = 9400. dailyLossFloor = 10000*0.10 = 1000 (never trips).
    const bars = [
      bar(0, { equityLow: 9_900, equityClose: 9_920 }),
      bar(1, { equityLow: 9_700, equityClose: 9_720 }),
      bar(2, { equityLow: 9_399, equityClose: 9_420 }), // 9399 <= 9400 -> breach
    ];
    const outcome = evaluatePropRun(bars, 10_000, baseConfig);
    expect(outcome).toEqual({ kind: 'breach', cause: 'total', atTimestamp: bars[2]!.timestamp, barsElapsed: 3 });
  });

  it('breaches on the daily floor before the static floor would trip', () => {
    // dailyLossFloor = 10000 * (1 - 3/100) = 9700, tighter than staticFloor 9400 here.
    const config: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 3 };
    const bars = [
      bar(0, { equityLow: 9_900, equityClose: 9_920 }),
      bar(1, { equityLow: 9_699, equityClose: 9_710 }), // 9699 <= 9700 (daily) but > 9400 (static)
    ];
    const outcome = evaluatePropRun(bars, 10_000, config);
    expect(outcome).toEqual({ kind: 'breach', cause: 'daily', atTimestamp: bars[1]!.timestamp, barsElapsed: 2 });
  });

  it('passes on reaching +10% close without ever breaching', () => {
    const config: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 50, maxDrawdownPct: 50 };
    const bars = [
      bar(0, { equityLow: 10_050, equityHigh: 10_150, equityClose: 10_100 }),
      bar(1, { equityLow: 10_250, equityHigh: 11_050, equityClose: 11_000 }), // 11000 = 10000*1.10 exactly
    ];
    const outcome = evaluatePropRun(bars, 10_000, config);
    expect(outcome).toEqual({ kind: 'pass', atTimestamp: bars[1]!.timestamp, barsElapsed: 2 });
  });

  it('reports ongoing when it runs out of bars before pass or breach', () => {
    const config: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 50, maxDrawdownPct: 50 };
    const bars = [
      bar(0, { equityLow: 9_950, equityClose: 10_050 }),
      bar(1, { equityLow: 9_980, equityClose: 10_080 }),
    ];
    expect(evaluatePropRun(bars, 10_000, config)).toEqual({ kind: 'ongoing' });
    expect(evaluatePropRun([], 10_000, config)).toEqual({ kind: 'ongoing' });
  });

  it('recomputes dayStartEquity/dailyLossFloor at the next UTC day, using the prior close', () => {
    // Day 1 (2026-01-01): two profitable bars, close ends the day at 10300.
    // Day 2 (2026-01-02) starts: dayStartEquity becomes 10300 (carried from the last close),
    // so dailyLossFloor = 10300 * (1 - 3/100) = 9991 -- HIGHER than day 1's floor of 9700.
    const config: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 3, maxDrawdownPct: 50 };
    const bars = [
      bar(0, { timestamp: Date.UTC(2026, 0, 1, 0), equityLow: 10_050, equityClose: 10_100 }),
      bar(1, { timestamp: Date.UTC(2026, 0, 1, 12), equityLow: 10_090, equityClose: 10_300 }),
      // First bar of day 2 (crosses the 00:00 UTC boundary): equityLow 9990 is
      // BELOW the recomputed day-2 floor (9991) but would NOT have breached
      // day 1's stale floor (9700) -- proves the recompute actually happened.
      bar(2, { timestamp: Date.UTC(2026, 0, 2, 0), equityLow: 9_990, equityClose: 9_995 }),
    ];
    const outcome = evaluatePropRun(bars, 10_000, config);
    expect(outcome).toEqual({ kind: 'breach', cause: 'daily', atTimestamp: bars[2]!.timestamp, barsElapsed: 3 });
  });

  it('accumulates fees toward the static floor across bars', () => {
    // staticFloor = 9400. Bar 2's raw equityLow (9450) alone would NOT breach
    // (9450 > 9400), but cumulative fees (40 + 60 = 100) push adjusted equity
    // to 9450 - 100 = 9350 <= 9400.
    const bars = [
      bar(0, { equityLow: 9_500, equityClose: 9_520, feesThisBar: 40 }),
      bar(1, { equityLow: 9_450, equityClose: 9_470, feesThisBar: 60 }),
    ];
    const outcome = evaluatePropRun(bars, 10_000, baseConfig);
    expect(outcome).toEqual({ kind: 'breach', cause: 'total', atTimestamp: bars[1]!.timestamp, barsElapsed: 2 });
  });

  it('picks whichever floor is numerically higher when both trip on the same bar', () => {
    // Normal ordering: dailyLossFloor (9700) > staticFloor (9400) -> 'daily'.
    const normal: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 3, maxDrawdownPct: 6 };
    const normalOutcome = evaluatePropRun([bar(0, { equityLow: 9_200 })], 10_000, normal);
    expect(normalOutcome).toEqual({ kind: 'breach', cause: 'daily', atTimestamp: T0, barsElapsed: 1 });

    // Inverted ordering: staticFloor (9800) > dailyLossFloor (9000) -> 'total'.
    const inverted: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 10, maxDrawdownPct: 2 };
    const invertedOutcome = evaluatePropRun([bar(0, { equityLow: 8_900 })], 10_000, inverted);
    expect(invertedOutcome).toEqual({ kind: 'breach', cause: 'total', atTimestamp: T0, barsElapsed: 1 });
  });

  it('rejects a non-positive initial balance', () => {
    expect(() => evaluatePropRun([bar(0)], 0, baseConfig)).toThrow(RangeError);
    expect(() => evaluatePropRun([bar(0)], -100, baseConfig)).toThrow(RangeError);
  });
});

describe('tradingDayKey', () => {
  it('shifts the day boundary to dailyResetHourUtc instead of midnight', () => {
    // 00:29 UTC is still "yesterday" under a 00:30 reset; 00:31 is the new day.
    const before = Date.UTC(2026, 0, 2, 0, 29);
    const after = Date.UTC(2026, 0, 2, 0, 31);
    expect(tradingDayKey(before, 0.5)).toBe(tradingDayKey(Date.UTC(2026, 0, 1, 12), 0.5));
    expect(tradingDayKey(after, 0.5)).not.toBe(tradingDayKey(before, 0.5));
  });
});

describe('feesForBar', () => {
  const config: PropRulesetConfig = {
    name: 'breakout',
    profitTargetPct: 10,
    maxDailyLossPct: 3,
    maxDrawdownPct: 6,
    dailyResetHourUtc: 0.5,
    feePctPerSide: 0.04,
    swapPctPerDayPerPosition: 0.033,
  };

  it('charges entry/exit spread fee plus prorated overnight swap', () => {
    // sideFee = (1000 + 500) * (0.04/100) = 1500 * 0.0004 = 0.6
    // swap = 2000 * (0.033/100) * (1/24) = 2000 * 0.00033 / 24 = 0.66 / 24 = 0.0275
    const total = feesForBar(
      { timestamp: T0, openedNotional: 1_000, closedNotional: 500, openNotionalAfterBar: 2_000, barHours: 1 },
      config,
    );
    expect(total).toBeCloseTo(0.6 + 0.0275, 10);
  });

  it('is zero when the ruleset states no fee/swap figure', () => {
    const noFeeConfig: PropRulesetConfig = { ...config, feePctPerSide: undefined, swapPctPerDayPerPosition: undefined };
    const total = feesForBar(
      { timestamp: T0, openedNotional: 1_000, closedNotional: 500, openNotionalAfterBar: 2_000, barHours: 1 },
      noFeeConfig,
    );
    expect(total).toBe(0);
  });
});

describe('worstDailyDrawdownPct', () => {
  it('finds the worst single-day floating drawdown, independent of outcome', () => {
    // Day 1 starts at 10000; worst intraday low that day is 9600 -> (10000-9600)/10000 = 4%.
    // Day 2 starts at the day-1 close (10100); worst low that day is 9797 -> (10100-9797)/10100 = 3%.
    // The worse of the two days is day 1's 4%.
    const config: PropRulesetConfig = { ...baseConfig, maxDailyLossPct: 50, maxDrawdownPct: 50 };
    const bars: PropBar[] = [
      { timestamp: Date.UTC(2026, 0, 1, 0), equityLow: 9_600, equityHigh: 10_050, equityClose: 9_800, feesThisBar: 0 },
      { timestamp: Date.UTC(2026, 0, 1, 12), equityLow: 9_750, equityHigh: 10_200, equityClose: 10_100, feesThisBar: 0 },
      { timestamp: Date.UTC(2026, 0, 2, 0), equityLow: 9_797, equityHigh: 10_150, equityClose: 10_050, feesThisBar: 0 },
    ];
    expect(worstDailyDrawdownPct(bars, 10_000, config)).toBeCloseTo(4, 10);
  });

  it('is zero for an empty run or a non-positive initial balance', () => {
    const config: PropRulesetConfig = { ...baseConfig };
    expect(worstDailyDrawdownPct([], 10_000, config)).toBe(0);
    expect(worstDailyDrawdownPct([bar(0)], 0, config)).toBe(0);
  });
});
