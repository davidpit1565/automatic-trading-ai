/**
 * Signal Engine — Stage 2.
 *
 * Consumes verified Market Scanner output and turns strong setups into
 * structured, explainable trade opportunities. It performs NO indicator
 * math of its own: every input comes from the scanner snapshot, so the
 * indicator engine remains the single source of analysis.
 *
 * Long-only: this platform simulates spot positions, so bearish evidence
 * yields a rejection (with reasons), never a short signal.
 *
 * Every quality gate that fails is reported — a rejection explains itself
 * as thoroughly as an opportunity does. Confidence is capped below 100 by
 * design: markets are uncertain and this engine never claims certainty.
 */

import type { MarketScan, ScanResult } from '../scan/marketScanner';
import type { Timeframe } from '../types';

export interface SignalCriteria {
  /** Minimum scanner score (bullish evidence) to consider a long setup. */
  readonly minScore: number;
  /** Minimum ADX: below this the trend is too weak to trust. */
  readonly minAdx: number;
  /** RSI ceiling for new longs: above this the move is overextended. */
  readonly maxRsiForLong: number;
  /** Stop loss distance in ATR multiples below entry. */
  readonly atrStopMultiple: number;
  /** Take profit distance in ATR multiples above entry. */
  readonly atrTargetMultiple: number;
  /** Minimum acceptable reward-to-risk ratio. */
  readonly minRiskReward: number;
  /** Maximum ATR as % of price: beyond this, volatility is unmanageable. */
  readonly maxAtrPct: number;
}

export const DEFAULT_SIGNAL_CRITERIA: SignalCriteria = {
  minScore: 30,
  minAdx: 20,
  maxRsiForLong: 75,
  atrStopMultiple: 2,
  atrTargetMultiple: 4,
  minRiskReward: 1.5,
  maxAtrPct: 8,
};

/**
 * Hard ceiling on confidence. Never 100: no amount of technical evidence
 * makes an outcome certain, and the engine must not pretend otherwise.
 */
export const MAX_CONFIDENCE = 90;

/** Confidence component weights (points). */
const CONFIDENCE_WEIGHTS = {
  /** Points per scanner score point. */
  scoreFactor: 0.6,
  /** Maximum bonus for strong trend (ADX). */
  trendMax: 15,
  /** Maximum bonus for above-average volume participation. */
  volumeMax: 10,
  /** Penalty per scanner warning. */
  warningPenalty: 8,
} as const;

/** ADX range over which the trend bonus scales from 0 to trendMax. */
const ADX_BONUS_FLOOR = 20;
const ADX_BONUS_CEILING = 50;

export interface TradeLevels {
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** (takeProfit - entry) / (entry - stopLoss). */
  readonly riskReward: number;
}

export interface ConfidenceComponent {
  readonly label: string;
  readonly detail: string;
  /** Signed contribution in confidence points. */
  readonly effect: number;
}

export interface TradeOpportunity {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly direction: 'long';
  readonly levels: TradeLevels;
  /** 0..MAX_CONFIDENCE — evidence strength, never certainty. */
  readonly confidence: number;
  readonly confidenceComponents: ConfidenceComponent[];
  /** Plain-language reasoning, including explicit uncertainty. */
  readonly explanation: string;
  /** Scanner warnings carried through unmodified. */
  readonly warnings: string[];
  /** Traceability back to the scan this signal was derived from. */
  readonly basedOn: { readonly score: number; readonly candleCount: number };
}

export type SignalDecision =
  | { readonly kind: 'opportunity'; readonly opportunity: TradeOpportunity }
  | {
      readonly kind: 'rejected';
      readonly symbol: string;
      readonly timeframe: Timeframe;
      readonly reasons: string[];
    };

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

/** Evaluate one verified scan result against the quality gates. */
export function evaluateScan(
  scan: ScanResult,
  criteria: SignalCriteria = DEFAULT_SIGNAL_CRITERIA,
): SignalDecision {
  validateCriteria(criteria);
  const { snapshot } = scan;
  const reasons: string[] = [];

  if (scan.score < 0) {
    reasons.push(
      `bearish evidence (score ${scan.score.toFixed(0)}) — this platform is long-only and does not simulate short positions`,
    );
  } else if (scan.score < criteria.minScore) {
    reasons.push(
      `insufficient bullish evidence: score ${scan.score.toFixed(0)} is below the required ${criteria.minScore}`,
    );
  }

  if (snapshot.adx === null) {
    reasons.push('trend strength unknown: ADX unavailable for this series');
  } else if (snapshot.adx < criteria.minAdx) {
    reasons.push(
      `weak trend: ADX ${snapshot.adx.toFixed(1)} is below the required ${criteria.minAdx}`,
    );
  }

  if (snapshot.rsi !== null && snapshot.rsi > criteria.maxRsiForLong) {
    reasons.push(
      `overextended: RSI ${snapshot.rsi.toFixed(1)} exceeds the long entry ceiling of ${criteria.maxRsiForLong}`,
    );
  }

  if (snapshot.atrPct === null) {
    reasons.push('cannot size risk: ATR unavailable for this series');
  } else if (snapshot.atrPct > criteria.maxAtrPct) {
    reasons.push(
      `volatility too high: ATR ${snapshot.atrPct.toFixed(1)}% of price exceeds the ${criteria.maxAtrPct}% limit`,
    );
  }

  const riskReward = criteria.atrTargetMultiple / criteria.atrStopMultiple;
  if (riskReward < criteria.minRiskReward) {
    reasons.push(
      `risk/reward ${riskReward.toFixed(2)} is below the required ${criteria.minRiskReward}`,
    );
  }

  let levels: TradeLevels | null = null;
  if (snapshot.atrPct !== null && snapshot.price > 0) {
    const atr = (snapshot.atrPct / 100) * snapshot.price;
    const entry = snapshot.price;
    const stopLoss = entry - criteria.atrStopMultiple * atr;
    const takeProfit = entry + criteria.atrTargetMultiple * atr;
    if (stopLoss <= 0) {
      reasons.push('stop loss would be at or below zero — volatility too large for the price');
    } else {
      levels = { entry, stopLoss, takeProfit, riskReward };
    }
  }

  if (reasons.length > 0 || levels === null) {
    return { kind: 'rejected', symbol: scan.symbol, timeframe: scan.timeframe, reasons };
  }

  const confidenceComponents = buildConfidenceComponents(scan);
  const confidence = clamp(
    confidenceComponents.reduce((total, c) => total + c.effect, 0),
    0,
    MAX_CONFIDENCE,
  );

  const opportunity: TradeOpportunity = {
    symbol: scan.symbol,
    timeframe: scan.timeframe,
    direction: 'long',
    levels,
    confidence,
    confidenceComponents,
    explanation: buildExplanation(scan, levels, confidence, criteria),
    warnings: [...scan.warnings],
    basedOn: { score: scan.score, candleCount: scan.candleCount },
  };
  return { kind: 'opportunity', opportunity };
}

function buildConfidenceComponents(scan: ScanResult): ConfidenceComponent[] {
  const components: ConfidenceComponent[] = [];
  const { snapshot } = scan;

  components.push({
    label: 'Scanner evidence',
    detail: `composite score ${scan.score.toFixed(0)} of 100`,
    effect: scan.score * CONFIDENCE_WEIGHTS.scoreFactor,
  });

  if (snapshot.adx !== null) {
    const strength = clamp(
      (snapshot.adx - ADX_BONUS_FLOOR) / (ADX_BONUS_CEILING - ADX_BONUS_FLOOR),
      0,
      1,
    );
    components.push({
      label: 'Trend strength',
      detail: `ADX ${snapshot.adx.toFixed(1)}`,
      effect: strength * CONFIDENCE_WEIGHTS.trendMax,
    });
  }

  if (snapshot.relativeVolume !== null && snapshot.relativeVolume > 1) {
    components.push({
      label: 'Volume participation',
      detail: `${snapshot.relativeVolume.toFixed(2)}× average volume`,
      effect: clamp(snapshot.relativeVolume - 1, 0, 1) * CONFIDENCE_WEIGHTS.volumeMax,
    });
  }

  if (scan.warnings.length > 0) {
    components.push({
      label: 'Active warnings',
      detail: scan.warnings.join('; '),
      effect: -CONFIDENCE_WEIGHTS.warningPenalty * scan.warnings.length,
    });
  }

  return components;
}

function buildExplanation(
  scan: ScanResult,
  levels: TradeLevels,
  confidence: number,
  criteria: SignalCriteria,
): string {
  const drivers = [...scan.components]
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((c) => `${c.label} (${c.detail})`);

  const warningText =
    scan.warnings.length > 0 ? ` Caution: ${scan.warnings.join('; ')}.` : '';

  return (
    `${scan.symbol} on the ${scan.timeframe} timeframe shows bullish technical evidence ` +
    `(score ${scan.score.toFixed(0)}/100 over ${scan.candleCount} candles), driven mainly by ` +
    `${drivers.join(', ')}. ` +
    `Suggested plan: enter near ${formatLevel(levels.entry)}, stop loss at ${formatLevel(levels.stopLoss)} ` +
    `(${criteria.atrStopMultiple}× ATR below entry), take profit at ${formatLevel(levels.takeProfit)} ` +
    `(${criteria.atrTargetMultiple}× ATR above), risk/reward ${levels.riskReward.toFixed(1)}.` +
    warningText +
    ` Confidence ${confidence.toFixed(0)}/${MAX_CONFIDENCE} reflects the strength of current evidence only — ` +
    `it is not a guarantee, and any position should be sized so its loss at the stop is acceptable.`
  );
}

function formatLevel(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  return v.toPrecision(4);
}

function validateCriteria(criteria: SignalCriteria): void {
  if (!(criteria.atrStopMultiple > 0) || !(criteria.atrTargetMultiple > 0)) {
    throw new RangeError('ATR multiples must be positive');
  }
  if (!(criteria.minScore >= 0)) throw new RangeError('minScore must be >= 0');
}

// ---------------------------------------------------------------------------
// Market-wide signal generation.
//
// Position sizing lives in the Risk Engine (src/core/risk) as of Stage 3 —
// the Signal Engine identifies opportunities; the Risk Engine decides
// whether the portfolio can safely take them and at what size.
// ---------------------------------------------------------------------------

export interface SignalReport {
  readonly timeframe: Timeframe;
  /** Qualifying opportunities, strongest confidence first. */
  readonly opportunities: TradeOpportunity[];
  /** Every non-qualifying market with its reasons — nothing is silent. */
  readonly rejections: { symbol: string; timeframe: Timeframe; reasons: string[] }[];
}

export function generateSignals(
  scan: MarketScan,
  criteria: SignalCriteria = DEFAULT_SIGNAL_CRITERIA,
): SignalReport {
  const opportunities: TradeOpportunity[] = [];
  const rejections: SignalReport['rejections'] = [];

  for (const result of scan.results) {
    const decision = evaluateScan(result, criteria);
    if (decision.kind === 'opportunity') opportunities.push(decision.opportunity);
    else rejections.push({ symbol: decision.symbol, timeframe: decision.timeframe, reasons: decision.reasons });
  }

  opportunities.sort((a, b) => b.confidence - a.confidence);
  return { timeframe: scan.timeframe, opportunities, rejections };
}
