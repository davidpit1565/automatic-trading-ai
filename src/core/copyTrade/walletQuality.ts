/**
 * Wallet Quality Score — research/measurement tool, Stage 2.
 *
 * Step 2 of David's deliberately cautious "smart money" exploration. The
 * Replay Engine (`replayEngine.ts`, Stage 1) answers "what would copying this
 * wallet have earned?". This module answers the next, narrower question:
 * given a wallet's OWN historical `ReplayResult`, how good is its track
 * record, so several tracked wallets can be ranked before ever deciding which
 * are worth following?
 *
 * Pure function of a `ReplayResult` — no I/O, no network, no live data, no
 * connection to the real risk/execution engine or the paper autopilot. Same
 * scope boundary as the Replay Engine: this deliberately does NOT build the
 * full multi-factor "Smart Money Score" (real-time trade size vs. liquidity,
 * multi-wallet consensus timing, etc.) — none of that is measurable without
 * a live data feed we don't have. It scores historical performance only.
 *
 * MODELED SCORING HEURISTIC (read before trusting any number here):
 * This is a first-pass, hand-picked heuristic — NOT an empirically validated
 * formula, NOT backtested against any ground truth of "wallets that were
 * actually worth following". Treat the weights and constants below exactly
 * like `replayEngine.ts`'s slippage/latency model: a documented, tunable
 * assumption, not a fact. The exact formula:
 *
 *   roiScore       = clamp(50 + aggregate.roiPct / 2, 0, 100)
 *                    // saturating map: +100% ROI -> 100, -100% ROI -> 0,
 *                    // breakeven (0% ROI) -> 50.
 *   winRateScore    = aggregate.winRatePct ?? 50   // neutral when undefined
 *   drawdownScore   = clamp(100 - aggregate.maxDrawdownPct, 0, 100)
 *   rawPerformanceScore =
 *     0.5 * roiScore + 0.25 * winRateScore + 0.25 * drawdownScore
 *
 *   sampleSizeWeight = tradeCount / (tradeCount + K)
 *                    // K = sampleSizeHalfWeightTrades (default
 *                    // DEFAULT_SAMPLE_SIZE_HALF_WEIGHT_TRADES = 10): a
 *                    // pseudo-count after which confidence is "half
 *                    // trusted"; asymptotically approaches 1 as trades grow.
 *                    // This is the low-sample-size guard: one lucky trade
 *                    // (tradeCount = 1) gets sampleSizeWeight = 1/11 ≈ 0.09,
 *                    // so its raw score is pulled almost all the way back
 *                    // to the neutral midpoint below, rather than standing
 *                    // in as if it were 50 consistent trades.
 *
 *   tokensProfitable = count of perToken entries with realizedPnl > 0
 *   diversityWeight  = 0.5 + 0.5 * min(tokensProfitable, D) / D
 *                    // D = diversitySaturationTokens (default
 *                    // DEFAULT_DIVERSITY_SATURATION_TOKENS = 3): profitable
 *                    // on 1 independent token -> 0.5 + 0.5/3 ≈ 0.667;
 *                    // 2 -> ≈0.833; 3+ -> 1.0. A wallet profitable on only
 *                    // one token campaign is weaker evidence than one
 *                    // profitable across several independent tokens, so its
 *                    // score is shrunk toward neutral more.
 *
 *   confidenceWeight = sampleSizeWeight * diversityWeight   // in [0, 1]
 *   score = 50 + (rawPerformanceScore - 50) * confidenceWeight
 *                    // shrinkage toward the neutral midpoint (50): the less
 *                    // evidence (few trades, single token), the closer the
 *                    // final score sits to "unknown", regardless of how
 *                    // extreme the raw performance looks.
 *
 * With zero closed trades there is no evidence at all: `score` is `null` and
 * `confidence` is `'insufficient'` rather than reporting a falsely confident
 * number (e.g. the neutral 50 the shrinkage formula would otherwise produce).
 *
 * `confidence` is a human-readable bucket over `tradeCount`, presentational
 * only — it does not feed back into `score`:
 *   0 trades          -> 'insufficient'
 *   1-2 trades        -> 'low'
 *   3-9 trades        -> 'medium'
 *   10+ trades        -> 'high'
 * These thresholds, like everything else here, are a modeled guess, not a
 * measured cutoff.
 */

import type { ReplayResult } from './replayEngine';

/** See the module doc comment above for the exact formula this implements. */
export const DEFAULT_SAMPLE_SIZE_HALF_WEIGHT_TRADES = 10;
/** See the module doc comment above for the exact formula this implements. */
export const DEFAULT_DIVERSITY_SATURATION_TOKENS = 3;

/** Neutral midpoint the score shrinks toward when evidence is thin. See module doc comment. */
const NEUTRAL_SCORE = 50;

export interface WalletQualityOptions {
  /**
   * Pseudo-count controlling how fast confidence grows with closed-trade
   * count. Heuristic, overridable per call. Default
   * `DEFAULT_SAMPLE_SIZE_HALF_WEIGHT_TRADES`.
   */
  readonly sampleSizeHalfWeightTrades?: number;
  /**
   * Profitable-token count at which the diversity weight saturates at 1.
   * Heuristic, overridable per call. Default
   * `DEFAULT_DIVERSITY_SATURATION_TOKENS`.
   */
  readonly diversitySaturationTokens?: number;
}

export type WalletQualityConfidence = 'insufficient' | 'low' | 'medium' | 'high';

export interface WalletQualityScore {
  /**
   * 0-100, higher is a stronger historical track record. `null` when there
   * are zero closed trades — no evidence to score at all (see `confidence`).
   */
  readonly score: number | null;
  /** Human-readable sample-size bucket. Presentational only; see module doc comment. */
  readonly confidence: WalletQualityConfidence;
  /** True only when there are zero closed trades (nothing to measure). */
  readonly insufficientData: boolean;
  readonly tradeCount: number;
  readonly tokensTraded: number;
  readonly tokensProfitable: number;
  /** Intermediate values, exposed for interpretability/debugging — see module doc comment for the formula. */
  readonly components: {
    readonly roiScore: number;
    readonly winRateScore: number;
    readonly drawdownScore: number;
    readonly rawPerformanceScore: number;
    readonly sampleSizeWeight: number;
    readonly diversityWeight: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function confidenceBucket(tradeCount: number): WalletQualityConfidence {
  if (tradeCount === 0) return 'insufficient';
  if (tradeCount < 3) return 'low';
  if (tradeCount < 10) return 'medium';
  return 'high';
}

/**
 * Score a wallet's own historical track record from its `ReplayResult`
 * (the Replay Engine's output for that wallet's trades). Pure function — see
 * the module doc comment for the exact, hand-picked formula and its honesty
 * caveat: this is a first-pass heuristic, not a validated model.
 */
export function scoreWalletQuality(result: ReplayResult, opts?: WalletQualityOptions): WalletQualityScore {
  const K = opts?.sampleSizeHalfWeightTrades ?? DEFAULT_SAMPLE_SIZE_HALF_WEIGHT_TRADES;
  const D = opts?.diversitySaturationTokens ?? DEFAULT_DIVERSITY_SATURATION_TOKENS;

  const { tradeCount, roiPct, winRatePct, maxDrawdownPct } = result.aggregate;
  const tokensTraded = result.perToken.length;
  const tokensProfitable = result.perToken.filter((t) => t.realizedPnl > 0).length;

  const roiScore = clamp(NEUTRAL_SCORE + roiPct / 2, 0, 100);
  const winRateScore = winRatePct ?? NEUTRAL_SCORE;
  const drawdownScore = clamp(100 - maxDrawdownPct, 0, 100);
  const rawPerformanceScore = 0.5 * roiScore + 0.25 * winRateScore + 0.25 * drawdownScore;

  const sampleSizeWeight = tradeCount / (tradeCount + K);
  const diversityWeight = 0.5 + 0.5 * (Math.min(tokensProfitable, D) / D);
  const confidenceWeight = sampleSizeWeight * diversityWeight;

  const insufficientData = tradeCount === 0;
  const score = insufficientData ? null : NEUTRAL_SCORE + (rawPerformanceScore - NEUTRAL_SCORE) * confidenceWeight;

  return {
    score,
    confidence: confidenceBucket(tradeCount),
    insufficientData,
    tradeCount,
    tokensTraded,
    tokensProfitable,
    components: { roiScore, winRateScore, drawdownScore, rawPerformanceScore, sampleSizeWeight, diversityWeight },
  };
}

export interface RankedWallet<TId> {
  readonly id: TId;
  readonly result: ReplayResult;
  readonly quality: WalletQualityScore;
}

/**
 * Score and rank several wallets' `ReplayResult`s by quality score,
 * descending (best track record first). Wallets with `insufficientData`
 * (`score === null`) sort last — there isn't enough evidence to place them
 * anywhere else. For the "which of my tracked wallets is actually worth
 * following" comparison.
 */
export function rankWalletsByQuality<TId>(
  wallets: readonly { id: TId; result: ReplayResult }[],
  opts?: WalletQualityOptions,
): RankedWallet<TId>[] {
  return wallets
    .map((w) => ({ id: w.id, result: w.result, quality: scoreWalletQuality(w.result, opts) }))
    .sort((a, b) => (b.quality.score ?? -Infinity) - (a.quality.score ?? -Infinity));
}
