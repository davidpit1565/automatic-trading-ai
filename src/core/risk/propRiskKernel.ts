/**
 * Prop-firm rule kernel — pure math, no I/O, no clock reads.
 *
 * Evaluates whether a chronological equity stream would have PASSED or
 * BREACHED a prop-firm challenge ruleset (Kraken Prop/Breakout,
 * HyroTrader, ...). This is deliberately separate from
 * `drawdownBreaker.ts`: that breaker is a TRAILING-peak circuit breaker
 * (this platform's own risk control), while a prop firm's max-loss rule is
 * measured from the STATIC initial balance and never moves — reusing the
 * trailing-peak shape here would silently model the wrong rule.
 *
 * This module answers one question only: "given this equity history, would
 * this specific ruleset have passed or breached it, and when?" It has no
 * opinion on strategy, sizing, or execution — those live upstream in the
 * replay harness that produces the bar stream this kernel consumes.
 */

export interface PropRulesetConfig {
  readonly name: string;
  /** Equity gain (% of initial balance) that ends the challenge in a pass. */
  readonly profitTargetPct: number;
  /** Max intraday loss (% of the CURRENT trading day's start equity). */
  readonly maxDailyLossPct: number;
  /** Max loss (% of the ORIGINAL initial balance) — static, never trailing. */
  readonly maxDrawdownPct: number;
  /**
   * UTC hour-of-day (0-23.999..) at which the trading day resets and
   * `maxDailyLossPct`'s baseline re-anchors to the equity carried in from
   * the previous bar. 0.5 = 00:30 UTC.
   */
  readonly dailyResetHourUtc: number;
  /** Round-trip cost per side, e.g. 0.04 for Breakout. Omit/0 if unknown. */
  readonly feePctPerSide?: number;
  /** Overnight financing per open position per day, e.g. 0.033 for Breakout. */
  readonly swapPctPerDayPerPosition?: number;
}

export type PropOutcome =
  | { readonly kind: 'pass'; readonly atTimestamp: number; readonly barsElapsed: number }
  | {
      readonly kind: 'breach';
      readonly cause: 'daily' | 'total';
      readonly atTimestamp: number;
      readonly barsElapsed: number;
    }
  | { readonly kind: 'ongoing' }; // ran out of bars before either pass or breach

/**
 * One bar of the account's equity history, as seen from OUTSIDE the trading
 * strategy (the strategy itself only ever sees closes — see
 * `scripts/lib/propReplayHarness.mts`). `equityLow`/`equityHigh` are the
 * account's floating equity mark-to-marketed at the bar's low/high price
 * extremes (worst/best case that bar), NOT just its close.
 */
export interface PropBar {
  readonly timestamp: number;
  readonly equityLow: number;
  readonly equityHigh: number;
  readonly equityClose: number;
  /** Prop-broker fee/swap drag charged this bar (>= 0, already in account currency). */
  readonly feesThisBar: number;
}

/**
 * The UTC calendar-day key of `timestamp`, shifted so the "day" boundary
 * falls at `dailyResetHourUtc` instead of midnight. Two timestamps share a
 * key iff no daily reset boundary falls between them. Exported so reporting
 * code (median bars-to-outcome, worst daily drawdown, ...) can bucket by the
 * SAME day definition the kernel uses, instead of re-deriving it and risking
 * drift between the two.
 */
export function tradingDayKey(timestamp: number, dailyResetHourUtc: number): string {
  const shifted = timestamp - dailyResetHourUtc * 3_600_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Evaluate one chronological bar stream against one prop ruleset.
 *
 * Per bar, in order:
 * 1. If this bar crosses the daily-reset boundary since the previous bar,
 *    re-anchor `dayStartEquity` to the equity carried in from the previous
 *    bar's close (fee-adjusted), and recompute `dailyLossFloor` from it.
 * 2. Accumulate this bar's fee/swap drag into a running total.
 * 3. Check the bar's WORST extreme (`equityLow`, fee-adjusted) against both
 *    the daily floor and the static floor. A breach on either ends the run
 *    immediately — if both trip on the same bar, report whichever floor is
 *    numerically HIGHER (the one equity would have crossed first on the way
 *    down).
 * 4. Only if not breached this bar, check the bar's close (fee-adjusted)
 *    against the profit target for a pass.
 */
export function evaluatePropRun(
  bars: readonly PropBar[],
  initialBalance: number,
  config: PropRulesetConfig,
): PropOutcome {
  if (!(initialBalance > 0)) {
    throw new RangeError(`initialBalance must be > 0, got ${initialBalance}`);
  }
  if (bars.length === 0) return { kind: 'ongoing' };

  const staticFloor = initialBalance * (1 - config.maxDrawdownPct / 100);
  const profitTarget = initialBalance * (1 + config.profitTargetPct / 100);

  let dayStartEquity = initialBalance;
  let dailyLossFloor = dayStartEquity * (1 - config.maxDailyLossPct / 100);
  let dayKey: string | null = null;
  let cumulativeFees = 0;
  /** Fee-adjusted equity carried in from the previous bar's close. */
  let carriedEquity = initialBalance;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const barsElapsed = i + 1;
    const key = tradingDayKey(bar.timestamp, config.dailyResetHourUtc);

    if (dayKey === null) {
      dayKey = key;
    } else if (key !== dayKey) {
      dayStartEquity = carriedEquity;
      dailyLossFloor = dayStartEquity * (1 - config.maxDailyLossPct / 100);
      dayKey = key;
    }

    cumulativeFees += bar.feesThisBar;
    const adjLow = bar.equityLow - cumulativeFees;
    const adjClose = bar.equityClose - cumulativeFees;

    const dailyBreached = adjLow <= dailyLossFloor;
    const totalBreached = adjLow <= staticFloor;
    if (dailyBreached || totalBreached) {
      // Whichever floor is numerically higher would have been crossed
      // first as equity fell — report that one. A tie defaults to 'daily'
      // (the normally-tighter, nearer constraint), never hardcoded as the
      // only path: it falls out of the same `>=` comparison.
      const cause: 'daily' | 'total' =
        dailyBreached && totalBreached
          ? dailyLossFloor >= staticFloor
            ? 'daily'
            : 'total'
          : dailyBreached
            ? 'daily'
            : 'total';
      return { kind: 'breach', cause, atTimestamp: bar.timestamp, barsElapsed };
    }

    if (adjClose >= profitTarget) {
      return { kind: 'pass', atTimestamp: bar.timestamp, barsElapsed };
    }

    carriedEquity = adjClose;
  }

  return { kind: 'ongoing' };
}

/**
 * Fee/swap overlay: turns a ruleset-independent equity/trade-activity
 * ledger into the ruleset-specific `feesThisBar` stream `evaluatePropRun`
 * consumes. Pure and separate from the market replay so the (expensive)
 * strategy simulation runs once per config while cheaply re-priced against
 * every ruleset's own fee schedule.
 */
export interface FeeLedgerBar {
  readonly timestamp: number;
  /** Notional opened this bar (sum across all positions opened), for the entry-side fee. */
  readonly openedNotional: number;
  /** Notional closed this bar (sum across all positions closed), for the exit-side fee. */
  readonly closedNotional: number;
  /** Combined notional of positions still open AFTER this bar, for the daily swap charge. */
  readonly openNotionalAfterBar: number;
  /** Hours this bar spans (1 for 1h candles) — swap is prorated by this share of a day. */
  readonly barHours: number;
}

export function feesForBar(bar: FeeLedgerBar, config: PropRulesetConfig): number {
  const feePct = config.feePctPerSide ?? 0;
  const swapPctPerDay = config.swapPctPerDayPerPosition ?? 0;
  const sideFee = (bar.openedNotional + bar.closedNotional) * (feePct / 100);
  const swap = bar.openNotionalAfterBar * (swapPctPerDay / 100) * (bar.barHours / 24);
  return sideFee + swap;
}

/**
 * Reporting-only helper: the worst floating INTRADAY drawdown (% of that
 * day's start equity) seen anywhere in the run, regardless of whether the
 * run ultimately passed, breached, or is still ongoing. Mirrors
 * `evaluatePropRun`'s own day-boundary/fee bookkeeping exactly (same
 * `tradingDayKey`, same fee-adjusted equity) so the two never disagree on
 * what "today's start equity" was — this is a read of the same walk, not a
 * second opinion on it.
 */
export function worstDailyDrawdownPct(
  bars: readonly PropBar[],
  initialBalance: number,
  config: PropRulesetConfig,
): number {
  if (bars.length === 0 || !(initialBalance > 0)) return 0;

  let dayStartEquity = initialBalance;
  let dayKey: string | null = null;
  let cumulativeFees = 0;
  let carriedEquity = initialBalance;
  let worstPct = 0;

  for (const bar of bars) {
    const key = tradingDayKey(bar.timestamp, config.dailyResetHourUtc);
    if (dayKey === null) {
      dayKey = key;
    } else if (key !== dayKey) {
      dayStartEquity = carriedEquity;
      dayKey = key;
    }

    cumulativeFees += bar.feesThisBar;
    const adjLow = bar.equityLow - cumulativeFees;
    const adjClose = bar.equityClose - cumulativeFees;

    if (dayStartEquity > 0) {
      const ddPct = ((dayStartEquity - adjLow) / dayStartEquity) * 100;
      if (ddPct > worstPct) worstPct = ddPct;
    }
    carriedEquity = adjClose;
  }

  return worstPct;
}
