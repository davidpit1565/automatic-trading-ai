/**
 * "Regime-confirmed majors momentum" (RMM-7) forward test — PAPER ONLY, nothing here can place an order.
 *
 * What it is: a CONFIRMATION rule, not a forecast. When BTC has already gained >= +21.9% over the
 * last 30 closed days, buy BTC and ETH in equal parts and hold 7 days. Replayed through THIS module at
 * the project's cost (0.30% per side) on 2018-2026 daily EUR data: +2.40% per 7-day window (94 windows,
 * t 2.3, 66% winners). The threshold was fitted on 2018-22 (66 windows, +2.44%, in-sample); the
 * 2023-26 holdout is 28 windows, +2.31%, 90% interval +0.05% to +4.56%, and it also took part in
 * choosing the rule among 72 candidates. Best-of-72 family-wise p for this signal: 0.08 on the raw excess
 * return (which grows with the holding horizon, so it favours the 14-day hold, p = 0.002), but 0.004-0.006 for
 * 7 days once the statistic is divided by the horizon (3 / 7 / 14 days then score alike: p 0.001 / 0.004-0.006 /
 * 0.002). That per-day standardisation was chosen after seeing the raw result (one more trial). About 12 later
 * variants were tried on top, so the evidence grade is B (suggestive), not proven. Buying the same two coins on every day gives +0.28%.
 * The effect is the market-wide trend regime, not coin picking. It is NOT proven for 2025-26.
 * Judge it ONLY with `assessRegimeMajors`; its thresholds are frozen for the FORWARD data, but several were
 * set after seeing the historical replay (see the freeze ledger in the report). Do not change any
 * constant after the first forward window exists without a dated PROJECT_STATE entry.
 *
 * One decision per UTC day on CLOSED daily bars; entries/exits execute at the day's OPEN with a
 * per-side cost. Exits first, then entries, so a window can restart on the day the last one ends
 * (as in the study); a stop blocks any new window until the planned end of the stopped one.
 * The stop is checked once per day against the lows of closed bars.
 *
 * Idempotent per day: re-running within the same UTC day does nothing.
 */

import type { KeyValueStore } from '../data/storage';
import type { Candle } from '../types';
import { PROMOTION_BAR, assessPromotion, netPnl } from './promotionBar';

export const REGIME_MAJORS_RULE = {
  /** BTC 30-day close-to-close return on the last closed bar: 80th percentile of 2018-2022 (EUR). */
  btcMom30Min: 0.219,
  lookbackDays: 30,
  holdDays: 7,
  /**
   * Share of the STARTING cash deployed per window, split equally over the legs. A RISK budget, not a
   * performance choice: it scales account P&L and drawdown, not the per-window return. Worst planned
   * loss per window = 30% x 15.5% = 4.65% of equity, i.e. under a 5% budget. (For reference, the
   * replay's worst closed-window account drawdown is 9.2% at 30% and 12.0% at 40%.)
   */
  sleeveFraction: 0.3,
  /** Disaster stop below entry (fraction). Measured to cost ~0.9pp per window; it caps the tail. */
  stopFraction: 0.15,
  /**
   * Extra slippage when the stop fills (fraction of entry). The paper fill is the WORSE of
   * (stop level less this slippage) and the next open, because the stop is only checked once per
   * UTC day on the lows of closed bars: a gap through the stop is booked at the gap, never better.
   */
  stopSlippage: 0.005,
  /** BTC supplies the regime; both legs must have a current bar, otherwise no entry (fail safe). */
  regimeSymbol: 'XBTEUR',
  legs: ['XBTEUR', 'ETHEUR'],
} as const;

/** Same per-side cost the 20 other shadows are charged (0.30%), so the scorecard compares like with like. */
export const REGIME_MAJORS_COST_RATE = 0.003;
const STATE_KEY = 'state';
const JOURNAL_KEY = 'trade-journal';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RegimeReading {
  readonly on: boolean;
  readonly btcMom30: number;
}

/** BTC regime from CLOSED daily bars, oldest first. Null if fewer than lookback+1 bars. */
export function evaluateRegime(btcClosed: readonly Candle[]): RegimeReading | null {
  const n = REGIME_MAJORS_RULE.lookbackDays;
  if (btcClosed.length < n + 1) return null;
  const last = btcClosed[btcClosed.length - 1]!.close;
  const past = btcClosed[btcClosed.length - 1 - n]!.close;
  if (!(last > 0) || !(past > 0)) return null;
  const btcMom30 = last / past - 1;
  return { on: btcMom30 >= REGIME_MAJORS_RULE.btcMom30Min, btcMom30 };
}

interface LegPosition {
  readonly symbol: string;
  readonly entryTimestamp: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly entryFee: number;
  readonly stopPrice: number;
}

interface RegimeState {
  readonly startedAt: string;
  readonly initialCash: number;
  cash: number;
  positions: LegPosition[];
  lastDay: string | null;
  /**
   * No new window may open before this time (ms). Set to the planned end of the window whenever a
   * stop fires, so that a window stopped out on day 2 stays over until day 7 (as in the study)
   * instead of re-entering the same day when both legs were stopped and the regime is still on.
   */
  blockedUntil?: number;
  /**
   * Running control: every UTC day since the start, the net 7-day return of buying the legs at that
   * day's open and selling at the open 7 days later (cost both sides), accumulated as the 7 days
   * mature. `assessRegimeMajors` compares the regime windows with it, so the control is not hand-made.
   */
  uncond?: { n: number; sum: number };
}

/** Shape read by `scripts/promotionScorecard.mts` (fees = entry + exit, EUR). */
export interface RegimeTrade {
  readonly id: string;
  readonly symbol: string;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly positionSize: number;
  readonly fees: number;
  readonly exitReason: 'time-exit' | 'stop-loss';
  readonly returnPct: number;
}

export interface RegimeMajorsInput {
  /** UTC date 'YYYY-MM-DD' of today's (forming) daily bar. */
  readonly day: string;
  /** Unix ms of that day's 00:00 UTC — the execution time of today's decisions. */
  readonly dayStart: number;
  readonly markets: Readonly<Record<string, { readonly closed: readonly Candle[]; readonly todayOpen: number; readonly markPrice: number }>>;
  readonly initialCash: number;
  readonly costRate?: number;
}

export interface RegimeMajorsStanding {
  readonly startedAt: string;
  readonly equity: number;
  readonly returnPct: number;
  readonly windows: number;
  readonly openLegs: readonly string[];
  readonly regimeOn: boolean | null;
  readonly btcMom30: number | null;
  readonly entriesToday: readonly string[];
  readonly exitsToday: readonly string[];
  /** Mean net 7-day return of the always-on control so far, null before the first 7 days have matured. */
  readonly unconditionalMean: number | null;
  readonly unconditionalDays: number;
}

export function stepRegimeMajors(store: KeyValueStore, input: RegimeMajorsInput): RegimeMajorsStanding {
  const rule = REGIME_MAJORS_RULE;
  const cost = input.costRate ?? REGIME_MAJORS_COST_RATE;
  const state: RegimeState = store.get<RegimeState>(STATE_KEY) ?? {
    startedAt: input.day,
    initialCash: input.initialCash,
    cash: input.initialCash,
    positions: [],
    lastDay: null,
  };
  const journal = store.get<RegimeTrade[]>(JOURNAL_KEY) ?? [];
  const entriesToday: string[] = [];
  const exitsToday: string[] = [];
  const btc = input.markets[rule.regimeSymbol];
  const regime = btc ? evaluateRegime(btc.closed) : null;

  if (state.lastDay !== input.day) {
    // 1) Exits: the disaster stop (lows of the bars since entry) first, then the time exit.
    const kept: LegPosition[] = [];
    for (const p of state.positions) {
      const m = input.markets[p.symbol];
      if (!m || !(m.todayOpen > 0)) {
        kept.push(p); // no price today: retried tomorrow (a stop still protects via the bar lows)
        continue;
      }
      const lowSince = Math.min(
        Number.POSITIVE_INFINITY,
        ...m.closed.filter((b) => b.timestamp >= p.entryTimestamp).map((b) => b.low),
      );
      const stopped = lowSince <= p.stopPrice;
      const due = input.dayStart - p.entryTimestamp >= rule.holdDays * DAY_MS;
      if (!stopped && !due) {
        kept.push(p);
        continue;
      }
      // A stop fires at the stop level less slippage, but never better than the price we can actually
      // get at today's open (a gap through the stop is booked at the gap).
      const exitPrice = stopped
        ? Math.min(p.entryPrice * (1 - rule.stopFraction - rule.stopSlippage), m.todayOpen)
        : m.todayOpen;
      const exitFee = p.quantity * exitPrice * cost;
      state.cash += p.quantity * exitPrice - exitFee;
      journal.push({
        id: `${p.symbol}:${p.entryTimestamp}`,
        symbol: p.symbol,
        entryTimestamp: p.entryTimestamp,
        exitTimestamp: input.dayStart,
        entryPrice: p.entryPrice,
        exitPrice,
        positionSize: p.quantity,
        fees: p.entryFee + exitFee,
        exitReason: stopped ? 'stop-loss' : 'time-exit',
        returnPct: ((p.quantity * exitPrice - exitFee) / (p.quantity * p.entryPrice + p.entryFee) - 1) * 100,
      });
      exitsToday.push(p.symbol);
      if (stopped) state.blockedUntil = Math.max(state.blockedUntil ?? 0, p.entryTimestamp + rule.holdDays * DAY_MS);
    }
    state.positions = kept;

    // 1b) Always-on control: the entry made `holdDays` ago matures at today's open.
    const matured = rule.legs.map((s) => {
      const m = input.markets[s];
      const then = m?.closed.find((b) => b.timestamp === input.dayStart - rule.holdDays * DAY_MS);
      return m && m.todayOpen > 0 && then && then.open > 0 && then.timestamp >= Date.parse(`${state.startedAt}T00:00:00Z`)
        ? (m.todayOpen * (1 - cost)) / (then.open * (1 + cost)) - 1
        : null;
    });
    if (matured.every((r): r is number => r !== null)) {
      const u = state.uncond ?? { n: 0, sum: 0 };
      state.uncond = { n: u.n + 1, sum: u.sum + matured.reduce((a, r) => a + r, 0) / matured.length };
    }

    // 2) Entry: flat, regime on, and EVERY leg has a current price.
    const legsReady = rule.legs.every((s) => (input.markets[s]?.todayOpen ?? 0) > 0);
    if (state.positions.length === 0 && regime?.on && legsReady && input.dayStart >= (state.blockedUntil ?? 0)) {
      const slotValue = (state.initialCash * rule.sleeveFraction) / rule.legs.length / (1 + cost);
      if (state.cash + 1e-6 >= slotValue * (1 + cost) * rule.legs.length) {
        for (const symbol of rule.legs) {
          const price = input.markets[symbol]!.todayOpen;
          const entryFee = slotValue * cost;
          state.cash -= slotValue + entryFee;
          state.positions.push({
            symbol,
            entryTimestamp: input.dayStart,
            entryPrice: price,
            quantity: slotValue / price,
            entryFee,
            stopPrice: price * (1 - rule.stopFraction),
          });
          entriesToday.push(symbol);
        }
      }
    }
    state.lastDay = input.day;
  }
  store.set(STATE_KEY, state);
  store.set(JOURNAL_KEY, journal.slice(-500));

  const equity =
    state.cash + state.positions.reduce((s, p) => s + p.quantity * (input.markets[p.symbol]?.markPrice ?? p.entryPrice), 0);
  return {
    startedAt: state.startedAt,
    equity,
    returnPct: (equity / state.initialCash - 1) * 100,
    windows: new Set(journal.map((t) => t.entryTimestamp)).size,
    openLegs: state.positions.map((p) => p.symbol),
    regimeOn: regime ? regime.on : null,
    btcMom30: regime ? regime.btcMom30 : null,
    entriesToday,
    exitsToday,
    unconditionalMean: state.uncond && state.uncond.n > 0 ? state.uncond.sum / state.uncond.n : null,
    unconditionalDays: state.uncond?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Pre-committed verdict (frozen 2026-10-23, BEFORE any forward window exists). Values marked
// 'replay-informed' were set after seeing the 2018-2026 replay; the rest were fixed beforehand.
// ---------------------------------------------------------------------------

/**
 * What this bar can and cannot do. The rule fired ~13 times a year in 2015-2024 but only 5 times
 * in 2025-26 (2.7 a year). At that rate a mean-based verdict needs 12 windows = ~4.4 years, and a
 * true +2.6% mean needs ~140 windows to confirm. So the forward test is a TRIPWIRE for gross
 * failure (an account drawdown at the project's own 15% line, or three disaster windows in a
 * row), not a confirmation, and it has a calendar limit after which it declares itself
 * inconclusive instead of waiting for ever. The historical record carries the "it worked" side.
 *
 * The pass side INHERITS the project's PROMOTION_BAR (profit factor, two of three parts
 * profitable, P(mean<=0), drawdown) through `assessPromotion`, run on one pseudo-trade per window;
 * the only relaxation is the window count (12 instead of 100), and every extra condition below is
 * additional, never a replacement.
 */
export const REGIME_MAJORS_BAR = {
  abort: {
    /** Replay-informed: evaluate the mean-based abort only after this many closed windows (8 would have falsely aborted ~7% of historical starts, 12 only ~1%). */
    minWindows: 12,
    /** Abort if the mean net window return is at or below this. */
    meanAtOrBelow: -0.01,
    /** Abort after this many consecutive windows each at or below `badWindow`. */
    consecutiveBad: 3,
    badWindow: -0.08,
    /** Abort at the project's own drawdown line (closed-window drawdown of starting cash + sleeve P&L). Not fitted to the replay. */
    accountDrawdownPct: PROMOTION_BAR.maxDrawdownPct,
  },
  pass: {
    minWindows: 12,
    minMonths: 6,
    /** Replay-informed materiality values (the replay mean is +2.4%, win rate 66%): about 1.7 round trips of cost, and a majority of windows. */
    meanAtLeast: 0.01,
    winRateAtLeast: 0.55,
    /**
     * Design value, set while the replay's worst window (-18.6%) was known, so it is replay-informed:
     * planned worst leg loss 15.5% + 0.6% costs = 16.1%, plus about 4 points of allowance for gaps
     * through a once-a-day stop. It CAN fail (fills can be worse than the stop); a floor of -25% would
     * also have passed the whole replay.
     */
    worstWindowAbove: -0.2,
    /** Replay-informed (the replay excess is +2.1 points): the mean window return must beat buying the same legs on EVERY day of the same period by this much. */
    minExcessOverUnconditional: 0.015,
    /** The control needs this many matured days before it counts. */
    minUnconditionalDays: 90,
  },
  /** After this many months, fewer than `pass.minWindows` windows = 'inconclusive' (stop spending attention on it). */
  reviewAfterMonths: 24,
} as const;

export interface RegimeMajorsVerdict {
  readonly windows: number;
  readonly meanReturn: number | null;
  readonly winRate: number | null;
  readonly worstWindow: number | null;
  readonly accountDrawdown: number;
  readonly probabilityMeanNotPositive: number | null;
  readonly status: 'abort' | 'inconclusive' | 'continue' | 'pass-pending-control' | 'pass';
  readonly reasons: readonly string[];
}

export interface RegimeMajorsAssessOptions {
  /** Mean net 7-day return of the always-on control (`RegimeMajorsStanding.unconditionalMean`). */
  readonly unconditionalMean?: number | null;
  readonly unconditionalDays?: number;
  /** Unix ms of the shadow's first day, and the current time, for the calendar review. */
  readonly startedAt?: number;
  readonly now?: number;
}

/**
 * Groups the journal into windows (legs sharing an entry time), then applies `REGIME_MAJORS_BAR`.
 * Without a usable control the best possible verdict is 'pass-pending-control'.
 */
export function assessRegimeMajors(
  journal: readonly { entryTimestamp: number; exitTimestamp: number; entryPrice: number; exitPrice: number; positionSize: number; fees: number }[],
  initialCash: number,
  options: RegimeMajorsAssessOptions = {},
): RegimeMajorsVerdict {
  const byWindow = new Map<number, { pnl: number; notional: number; exit: number }>();
  for (const t of journal) {
    const w = byWindow.get(t.entryTimestamp) ?? { pnl: 0, notional: 0, exit: 0 };
    w.pnl += netPnl(t);
    w.notional += t.entryPrice * t.positionSize;
    w.exit = Math.max(w.exit, t.exitTimestamp);
    byWindow.set(t.entryTimestamp, w);
  }
  const windows = [...byWindow.entries()].sort((a, b) => a[1].exit - b[1].exit);
  const returns = windows.map(([, w]) => w.pnl / w.notional);
  const n = returns.length;
  const mean = n > 0 ? returns.reduce((s, r) => s + r, 0) / n : null;
  let equity = initialCash;
  let peak = initialCash;
  let dd = 0;
  for (const [, w] of windows) {
    equity += w.pnl;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, (peak - equity) / peak);
  }
  let streak = 0;
  let maxStreak = 0;
  for (const r of returns) {
    streak = r <= REGIME_MAJORS_BAR.abort.badWindow ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }
  const reasons: string[] = [];
  const a = REGIME_MAJORS_BAR.abort;
  if (n >= a.minWindows && mean !== null && mean <= a.meanAtOrBelow) reasons.push(`mean ${(mean * 100).toFixed(1)}% <= ${(a.meanAtOrBelow * 100).toFixed(1)}% after ${n} windows`);
  if (maxStreak >= a.consecutiveBad) reasons.push(`${maxStreak} consecutive windows at or below ${(a.badWindow * 100).toFixed(0)}%`);
  if (dd * 100 >= a.accountDrawdownPct) reasons.push(`account drawdown ${(dd * 100).toFixed(1)}% >= ${a.accountDrawdownPct}%`);
  const base = {
    windows: n,
    meanReturn: mean,
    winRate: n > 0 ? returns.filter((r) => r > 0).length / n : null,
    worstWindow: n > 0 ? Math.min(...returns) : null,
    accountDrawdown: dd,
  };
  if (reasons.length > 0) return { ...base, probabilityMeanNotPositive: null, status: 'abort', reasons };

  const b = REGIME_MAJORS_BAR.pass;
  const firstEntry = n > 0 ? Math.min(...byWindow.keys()) : null;
  const months = n > 0 ? (windows[windows.length - 1]![1].exit - firstEntry!) / (30.4 * DAY_MS) : 0;
  // The project's own bar on one pseudo-trade per window (window count relaxed to `b.minWindows`).
  const promo = assessPromotion(
    windows.map(([, w]) => ({ entryPrice: w.notional, exitPrice: w.notional + w.pnl, positionSize: 1, fees: 0, exitTimestamp: w.exit })),
    initialCash,
    undefined,
    b.minWindows,
  );
  const p = promo.probabilityMeanNotPositive;
  const checks = [
    promo.checks.trades ? null : `only ${n}/${b.minWindows} windows`,
    months >= b.minMonths ? null : `only ${months.toFixed(1)}/${b.minMonths} months`,
    mean !== null && mean >= b.meanAtLeast ? null : 'mean below the bar',
    base.winRate !== null && base.winRate >= b.winRateAtLeast ? null : 'win rate below the bar',
    base.worstWindow !== null && base.worstWindow > b.worstWindowAbove ? null : 'a window lost more than the bar allows',
    promo.checks.profitFactor ? null : `profit factor ${promo.profitFactor === null ? 'n/a' : promo.profitFactor.toFixed(2)} below the project bar`,
    promo.checks.parts ? null : `only ${promo.partsProfitable}/3 time parts profitable`,
    promo.checks.significance ? null : `P(mean<=0) ${p.toFixed(2)} above the project bar`,
    promo.checks.drawdown ? null : `drawdown ${promo.maxDrawdownPct.toFixed(1)}% above the project bar`,
  ].filter((x): x is string => x !== null);
  if (checks.length > 0) {
    const late =
      options.startedAt !== undefined &&
      options.now !== undefined &&
      n < b.minWindows &&
      (options.now - options.startedAt) / (30.4 * DAY_MS) >= REGIME_MAJORS_BAR.reviewAfterMonths;
    if (late) {
      return { ...base, probabilityMeanNotPositive: p, status: 'inconclusive', reasons: [`only ${n} windows in ${REGIME_MAJORS_BAR.reviewAfterMonths}+ months: the regime is too rare for a forward verdict; retire the shadow or keep it dormant`] };
    }
    return { ...base, probabilityMeanNotPositive: p, status: 'continue', reasons: checks };
  }
  const u = options.unconditionalMean;
  if (u === undefined || u === null || (options.unconditionalDays ?? 0) < b.minUnconditionalDays) {
    return { ...base, probabilityMeanNotPositive: p, status: 'pass-pending-control', reasons: [`needs the always-on control (>= ${b.minUnconditionalDays} matured days)`] };
  }
  if (mean! - u < b.minExcessOverUnconditional) {
    return { ...base, probabilityMeanNotPositive: p, status: 'continue', reasons: ['does not beat buying the same legs every day by the required margin'] };
  }
  return { ...base, probabilityMeanNotPositive: p, status: 'pass', reasons: [] };
}
