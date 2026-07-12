/**
 * Multi-timeframe confirmation — Signal Engine extension.
 *
 * A qualifying signal on the entry timeframe is checked against the
 * higher timeframe's verified scan of the same symbol:
 *
 *   bearish higher timeframe  -> the trade is blocked (with the reason)
 *   bullish higher timeframe  -> a capped, itemised confidence bonus
 *   neutral higher timeframe  -> passes with an explicit warning
 *   unavailable               -> passes, flagged as unconfirmed
 *
 * Pure function over existing scanner output — no new indicator math.
 */

import type { ScanResult } from '../scan/marketScanner';
import { MAX_CONFIDENCE, type SignalDecision } from './signalEngine';

/** Confidence points granted when the higher timeframe confirms. */
const CONFIRMATION_BONUS = 8;
/** Higher-timeframe score at/above which the trend counts as confirming. */
const CONFIRMING_SCORE = 30;

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

export function applyHigherTimeframeGate(
  decision: SignalDecision,
  higher: ScanResult | null,
): SignalDecision {
  if (decision.kind === 'rejected') return decision;
  const opportunity = decision.opportunity;

  if (higher === null) {
    return {
      kind: 'opportunity',
      opportunity: {
        ...opportunity,
        warnings: [
          ...opportunity.warnings,
          'higher timeframe unavailable — this setup is unconfirmed by the larger trend',
        ],
      },
    };
  }

  // The scanner's own classification decides what counts as bearish —
  // 'cold' means strong bearish evidence (score at/below the threshold).
  if (higher.temperature === 'cold') {
    return {
      kind: 'rejected',
      symbol: opportunity.symbol,
      timeframe: opportunity.timeframe,
      reasons: [
        `higher timeframe (${higher.timeframe}) shows bearish evidence ` +
          `(score ${higher.score.toFixed(0)}) — a long against the larger trend is refused`,
      ],
    };
  }

  if (higher.score >= CONFIRMING_SCORE) {
    const confidence = clamp(opportunity.confidence + CONFIRMATION_BONUS, 0, MAX_CONFIDENCE);
    return {
      kind: 'opportunity',
      opportunity: {
        ...opportunity,
        confidence,
        confidenceComponents: [
          ...opportunity.confidenceComponents,
          {
            label: `Higher timeframe confirmation (${higher.timeframe})`,
            detail: `score ${higher.score.toFixed(0)} on the ${higher.timeframe} chart`,
            effect: confidence - opportunity.confidence,
          },
        ],
        explanation:
          opportunity.explanation +
          ` The larger ${higher.timeframe} trend confirms this setup ` +
          `(score ${higher.score.toFixed(0)}).`,
      },
    };
  }

  return {
    kind: 'opportunity',
    opportunity: {
      ...opportunity,
      warnings: [
        ...opportunity.warnings,
        `higher timeframe (${higher.timeframe}) is neutral (score ${higher.score.toFixed(0)}) — ` +
          `no confirmation from the larger trend`,
      ],
    },
  };
}
