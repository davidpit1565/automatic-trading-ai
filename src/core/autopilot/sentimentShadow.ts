/**
 * F2 sentiment-trend forward test — PAPER ONLY, nothing here can place an order.
 *
 * Tracks what a BTC position following `decideSentimentTrend` would have done,
 * one decision per UTC day, in its own isolated store namespace. Entries and
 * exits happen at the day's OPEN (matching the backtest: signal on the last
 * CLOSED bar, execution at the next open), with the same per-side cost the
 * backtest charged (0.19%). Reports its return next to plain BTC buy&hold from
 * the same start so "did it help?" is answered by a number, not a feeling.
 *
 * Idempotent per day: re-running within the same UTC day only re-marks the
 * position to the latest price.
 */

import type { KeyValueStore } from '../data/storage';
import { decideSentimentTrend } from '../signal/sentimentTrend';

export const SENTIMENT_SHADOW_COST_RATE = 0.0019;
const STATE_KEY = 'state';
const MAX_TRADES = 200;

export interface SentimentShadowTrade {
  readonly entryDay: string;
  readonly exitDay: string;
  readonly entryPrice: number;
  readonly exitPrice: number;
  /** Net of both sides' costs, as a percentage of the capital committed. */
  readonly netReturnPct: number;
}

interface SentimentShadowState {
  readonly startedAt: string;
  readonly anchorPrice: number;
  readonly initialCash: number;
  cash: number;
  qty: number;
  entryPrice: number | null;
  entryDay: string | null;
  entryCash: number;
  lastDay: string | null;
  lastReason: string;
  trades: SentimentShadowTrade[];
}

export interface SentimentShadowStanding {
  readonly startedAt: string;
  readonly equity: number;
  readonly returnPct: number;
  /** BTC buy&hold from the same start price, for comparison. */
  readonly btcReturnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly inPosition: boolean;
  readonly lastReason: string;
}

export interface SentimentShadowInput {
  /** UTC date 'YYYY-MM-DD' of today's (forming) daily bar. */
  readonly day: string;
  /** Fear & Greed readings from days BEFORE `day`, oldest first. */
  readonly fng: readonly number[];
  /** CLOSED daily closes (excluding today's forming bar), oldest first. */
  readonly closes: readonly number[];
  /** Today's open — the price any decision made today executes at. */
  readonly todayOpen: number;
  /** Latest price, for marking the position. */
  readonly markPrice: number;
  readonly initialCash: number;
  readonly costRate?: number;
}

export function stepSentimentShadow(store: KeyValueStore, input: SentimentShadowInput): SentimentShadowStanding {
  const cost = input.costRate ?? SENTIMENT_SHADOW_COST_RATE;
  let state = store.get<SentimentShadowState>(STATE_KEY);
  if (!state) {
    state = {
      startedAt: input.day,
      anchorPrice: input.todayOpen,
      initialCash: input.initialCash,
      cash: input.initialCash,
      qty: 0,
      entryPrice: null,
      entryDay: null,
      entryCash: 0,
      lastDay: null,
      lastReason: 'not started',
      trades: [],
    };
  }

  if (state.lastDay !== input.day) {
    const decision = decideSentimentTrend(input.fng, input.closes);
    state.lastReason = `${decision.hold ? 'HOLD' : 'CASH'}: ${decision.reason}`;
    if (decision.hold && state.qty === 0 && state.cash > 0) {
      state.entryCash = state.cash;
      state.qty = (state.cash * (1 - cost)) / input.todayOpen;
      state.cash = 0;
      state.entryPrice = input.todayOpen;
      state.entryDay = input.day;
    } else if (!decision.hold && state.qty > 0) {
      const proceeds = state.qty * input.todayOpen * (1 - cost);
      state.trades = [
        ...state.trades,
        {
          entryDay: state.entryDay ?? input.day,
          exitDay: input.day,
          entryPrice: state.entryPrice ?? input.todayOpen,
          exitPrice: input.todayOpen,
          netReturnPct: (proceeds / state.entryCash - 1) * 100,
        },
      ].slice(-MAX_TRADES);
      state.cash = proceeds;
      state.qty = 0;
      state.entryPrice = null;
      state.entryDay = null;
      state.entryCash = 0;
    }
    state.lastDay = input.day;
  }
  store.set(STATE_KEY, state);

  const equity = state.cash + state.qty * input.markPrice;
  const wins = state.trades.filter((t) => t.netReturnPct > 0).length;
  return {
    startedAt: state.startedAt,
    equity,
    returnPct: (equity / state.initialCash - 1) * 100,
    btcReturnPct: (input.markPrice / state.anchorPrice - 1) * 100,
    trades: state.trades.length,
    winRatePct: state.trades.length > 0 ? (100 * wins) / state.trades.length : null,
    inPosition: state.qty > 0,
    lastReason: state.lastReason,
  };
}
