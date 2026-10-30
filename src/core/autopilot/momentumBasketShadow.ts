/**
 * "Big-rise momentum" forward test — PAPER ONLY, nothing here can place an order.
 *
 * Built 2026-10-22 after a predictability study (28 coins, Coinbase EUR daily
 * 2018-2026, train 2018-2022 / test 2023-2026): the only features that raised
 * the odds of a >=+10% week in both periods were trend-continuation ones
 * (30-day momentum, RSI, position in the 20-day range). The rule below was
 * fixed from TRAIN-period quantiles and is FROZEN. On the held-out test years
 * it averaged +2.6% net per 7-day trade vs +0.1% for all coin-days, but the
 * 90% CI for the edge included zero, it came from the 2024 bull year (negative
 * in 2025/26), and it vanished with stops. So this is a hypothesis being
 * forward-tested, not a known edge; judge it with `promotionBar.ts`.
 *
 * One decision per UTC day on CLOSED daily bars; entries/exits execute at the
 * day's OPEN with a per-side cost. Hold HOLD_DAYS, no stop (stops removed the
 * edge in the study), up to MAX_POSITIONS equal-notional positions.
 *
 * Idempotent per day: re-running within the same UTC day does nothing.
 */

import type { KeyValueStore } from '../data/storage';
import type { Candle } from '../types';

export const MOMENTUM_BASKET_RULE = {
  /** 30-day return on the last closed bar (train 80th percentile). */
  mom30Min: 0.228,
  /** Wilder RSI(14) (train 80th percentile). */
  rsiMin: 58.4,
  /** Position of the close inside the 20-day high/low range (train 80th percentile). */
  rangePosMin: 0.74,
  holdDays: 7,
  maxPositions: 5,
} as const;

export const MOMENTUM_BASKET_COST_RATE = 0.002;
export const MOMENTUM_BASKET_MIN_BARS = 40;
const STATE_KEY = 'state';
const JOURNAL_KEY = 'trade-journal';
const DAY_MS = 24 * 60 * 60 * 1000;

/** RSI as the study computed it: EWM(alpha=1/period) seeded with the first change. */
export function wilderRsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const alpha = 1 / period;
  let gain = Math.max(closes[1]! - closes[0]!, 0);
  let loss = Math.max(closes[0]! - closes[1]!, 0);
  for (let i = 2; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (1 - alpha) * gain + alpha * Math.max(d, 0);
    loss = (1 - alpha) * loss + alpha * Math.max(-d, 0);
  }
  if (loss === 0) return gain === 0 ? null : 100;
  return 100 - 100 / (1 + gain / loss);
}

export interface MomentumBasketSignal {
  readonly qualifies: boolean;
  readonly mom30: number;
  readonly rsi: number;
  readonly rangePos: number;
}

/** Evaluates the frozen rule on CLOSED daily bars (oldest first); null if too little history. */
export function evaluateMomentumBasket(bars: readonly Candle[]): MomentumBasketSignal | null {
  if (bars.length < MOMENTUM_BASKET_MIN_BARS) return null;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const mom30 = last / closes[closes.length - 31]! - 1;
  const rsi = wilderRsi(closes);
  const window = bars.slice(-20);
  const hi = Math.max(...window.map((b) => b.high));
  const lo = Math.min(...window.map((b) => b.low));
  if (rsi === null || !(hi > lo)) return null;
  const rangePos = (last - lo) / (hi - lo);
  const r = MOMENTUM_BASKET_RULE;
  return { qualifies: mom30 >= r.mom30Min && rsi >= r.rsiMin && rangePos >= r.rangePosMin, mom30, rsi, rangePos };
}

interface BasketPosition {
  readonly symbol: string;
  readonly entryTimestamp: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly entryFee: number;
}

interface BasketState {
  readonly startedAt: string;
  readonly initialCash: number;
  cash: number;
  positions: BasketPosition[];
  lastDay: string | null;
}

/** Shape read by `scripts/promotionScorecard.mts` (fees = entry + exit, EUR). */
export interface BasketTrade {
  readonly id: string;
  readonly symbol: string;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly positionSize: number;
  readonly fees: number;
  readonly exitReason: 'time-exit';
  readonly returnPct: number;
}

export interface MomentumBasketInput {
  /** UTC date 'YYYY-MM-DD' of today's (forming) daily bar. */
  readonly day: string;
  /** Unix ms of that day's 00:00 UTC — the execution time of today's decisions. */
  readonly dayStart: number;
  /** Per symbol: CLOSED daily bars (excluding today's), oldest first; today's open; latest price. */
  readonly markets: Readonly<Record<string, { readonly closed: readonly Candle[]; readonly todayOpen: number; readonly markPrice: number }>>;
  readonly initialCash: number;
  /** Symbols that get no new entries (exits are unaffected). */
  readonly entryPaused?: ReadonlySet<string>;
  readonly costRate?: number;
  /** Entry rule on CLOSED bars; defaults to the frozen momentum rule. `rank`: higher is taken first. */
  readonly evaluate?: (closed: readonly Candle[]) => { readonly qualifies: boolean; readonly rank: number } | null;
}

/** Wilder RSI below this AND a 7-day drop deeper than OVERSOLD_DROP7 = "deeply oversold" (the bear-regime rule). */
export const OVERSOLD_RULE = { rsiMax: 25, drop7: -0.15 } as const;
const REGIME_SMA_DAYS = 100;

/** BTC regime: last closed close above its 100-day average. Null with too little history. */
export function btcRegimeUp(btcClosed: readonly Candle[]): boolean | null {
  if (btcClosed.length < REGIME_SMA_DAYS) return null;
  const last = btcClosed[btcClosed.length - 1]!.close;
  const sma = btcClosed.slice(-REGIME_SMA_DAYS).reduce((a, b) => a + b.close, 0) / REGIME_SMA_DAYS;
  return last > sma;
}

/** Deeply oversold rebound candidate: RSI(14) < 25 and 7-day return < -15% (rank: deeper drop first). */
export function evaluateOversold(bars: readonly Candle[]): { qualifies: boolean; rank: number } | null {
  if (bars.length < MOMENTUM_BASKET_MIN_BARS) return null;
  const closes = bars.map((b) => b.close);
  const rsi = wilderRsi(closes);
  const drop7 = closes[closes.length - 1]! / closes[closes.length - 8]! - 1;
  if (rsi === null) return null;
  return { qualifies: rsi < OVERSOLD_RULE.rsiMax && drop7 < OVERSOLD_RULE.drop7, rank: -drop7 };
}

/**
 * Regime switch: BTC above its 100-day average -> the frozen momentum rule; below -> the oversold rebound;
 * unknown regime -> no entries. Study 2018-2026 (28 coins): momentum +2.3%/7d when BTC is up but -3.6% when down.
 */
export function evaluateRegimeSwitch(regimeUp: boolean | null) {
  return (bars: readonly Candle[]): { qualifies: boolean; rank: number } | null => {
    if (regimeUp === null) return null;
    if (regimeUp) {
      const sig = evaluateMomentumBasket(bars);
      return sig ? { qualifies: sig.qualifies, rank: sig.mom30 } : null;
    }
    return evaluateOversold(bars);
  };
}

export interface MomentumBasketStanding {
  readonly startedAt: string;
  readonly equity: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly openPositions: readonly string[];
  readonly entriesToday: readonly string[];
  readonly exitsToday: readonly string[];
}

export function stepMomentumBasket(store: KeyValueStore, input: MomentumBasketInput): MomentumBasketStanding {
  const cost = input.costRate ?? MOMENTUM_BASKET_COST_RATE;
  const rule = MOMENTUM_BASKET_RULE;
  const state: BasketState = store.get<BasketState>(STATE_KEY) ?? {
    startedAt: input.day,
    initialCash: input.initialCash,
    cash: input.initialCash,
    positions: [],
    lastDay: null,
  };
  const journal = store.get<BasketTrade[]>(JOURNAL_KEY) ?? [];
  const entriesToday: string[] = [];
  const exitsToday: string[] = [];

  if (state.lastDay !== input.day) {
    // 1) Exits: held at least holdDays (a symbol with no price today is retried tomorrow).
    const kept: BasketPosition[] = [];
    for (const p of state.positions) {
      const m = input.markets[p.symbol];
      const due = input.dayStart - p.entryTimestamp >= rule.holdDays * DAY_MS;
      if (!due || !m || !(m.todayOpen > 0)) {
        kept.push(p);
        continue;
      }
      const exitFee = p.quantity * m.todayOpen * cost;
      state.cash += p.quantity * m.todayOpen - exitFee;
      journal.push({
        id: `${p.symbol}:${p.entryTimestamp}`,
        symbol: p.symbol,
        entryTimestamp: p.entryTimestamp,
        exitTimestamp: input.dayStart,
        entryPrice: p.entryPrice,
        exitPrice: m.todayOpen,
        positionSize: p.quantity,
        fees: p.entryFee + exitFee,
        exitReason: 'time-exit',
        returnPct: ((p.quantity * m.todayOpen - exitFee) / (p.quantity * p.entryPrice + p.entryFee) - 1) * 100,
      });
      exitsToday.push(p.symbol);
    }
    state.positions = kept;

    // 2) Entries: strongest 30-day momentum first, into free slots, fixed notional.
    const held = new Set(state.positions.map((p) => p.symbol));
    const candidates: { symbol: string; mom30: number }[] = [];
    for (const [symbol, m] of Object.entries(input.markets)) {
      if (held.has(symbol) || input.entryPaused?.has(symbol) || !(m.todayOpen > 0)) continue;
      const sig = input.evaluate
        ? input.evaluate(m.closed)
        : (() => {
            const r = evaluateMomentumBasket(m.closed);
            return r ? { qualifies: r.qualifies, rank: r.mom30 } : null;
          })();
      if (sig?.qualifies) candidates.push({ symbol, mom30: sig.rank });
    }
    candidates.sort((a, b) => b.mom30 - a.mom30);
    // Sized so that maxPositions slots PLUS their entry fees fit in the starting cash.
    const slotValue = state.initialCash / (rule.maxPositions * (1 + cost));
    for (const c of candidates) {
      if (state.positions.length >= rule.maxPositions) break;
      if (state.cash + 1e-6 < slotValue * (1 + cost)) break;
      const price = input.markets[c.symbol]!.todayOpen;
      const entryFee = slotValue * cost;
      state.cash -= slotValue + entryFee;
      state.positions.push({
        symbol: c.symbol,
        entryTimestamp: input.dayStart,
        entryPrice: price,
        quantity: slotValue / price,
        entryFee,
      });
      entriesToday.push(c.symbol);
    }
    state.lastDay = input.day;
  }
  store.set(STATE_KEY, state);
  store.set(JOURNAL_KEY, journal.slice(-500));

  const equity =
    state.cash + state.positions.reduce((s, p) => s + p.quantity * (input.markets[p.symbol]?.markPrice ?? p.entryPrice), 0);
  const wins = journal.filter((t) => (t.exitPrice - t.entryPrice) * t.positionSize - t.fees > 0).length;
  return {
    startedAt: state.startedAt,
    equity,
    returnPct: (equity / state.initialCash - 1) * 100,
    trades: journal.length,
    winRatePct: journal.length > 0 ? (100 * wins) / journal.length : null,
    openPositions: state.positions.map((p) => p.symbol),
    entriesToday,
    exitsToday,
  };
}
