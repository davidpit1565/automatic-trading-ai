/**
 * Alternative entry signals — genuinely different IDEAS, not new knob values.
 *
 * Why these exist: `scripts/sweepAutopilot.mts` proved the production signal
 * has a negative per-trade edge on real data. Every setting of it loses, and
 * more trading loses more. That is not a tuning problem, so the search has to
 * move to a different family of ideas.
 *
 * The production signal is long-only MOMENTUM: it buys strength that is not yet
 * overbought, confirmed by a larger uptrend. In a market falling 22% over four
 * months that is structurally hard — it is trying to buy strength in an
 * environment that has little.
 *
 * Each signal here emits the same `SignalDecision` the production one does, so
 * the risk engine, portfolio caps, exits and audit trail are identical and two
 * signals are compared on genuinely equal terms.
 *
 * NONE of these is wired to production. They are candidates to be measured and
 * then forward-tested, in that order.
 */

import type { ScanResult } from '../scan/marketScanner';
import { MAX_CONFIDENCE, type SignalDecision, type ConfidenceComponent } from './signalEngine';

/** ATR multiples for stop/target, matching the production signal's geometry. */
const ATR_STOP = 2;
const ATR_TARGET = 4;

function reject(scan: ScanResult, reason: string): SignalDecision {
  return { kind: 'rejected', symbol: scan.symbol, timeframe: scan.timeframe, reasons: [reason] };
}

/**
 * Build the same ATR-based levels the production signal uses, so a strategy is
 * judged on WHEN it enters, not on a different risk geometry.
 */
function levelsFor(scan: ScanResult): { entry: number; stopLoss: number; takeProfit: number; riskReward: number } | null {
  const { price, atrPct } = scan.snapshot;
  if (!(price > 0) || atrPct === null || !(atrPct > 0)) return null;
  const atr = (atrPct / 100) * price;
  const stopLoss = price - ATR_STOP * atr;
  if (!(stopLoss > 0)) return null;
  return { entry: price, stopLoss, takeProfit: price + ATR_TARGET * atr, riskReward: ATR_TARGET / ATR_STOP };
}

function opportunity(
  scan: ScanResult,
  confidence: number,
  components: ConfidenceComponent[],
  explanation: string,
): SignalDecision {
  const levels = levelsFor(scan);
  if (levels === null) return reject(scan, 'no usable ATR — cannot place a stop');
  return {
    kind: 'opportunity',
    opportunity: {
      symbol: scan.symbol,
      timeframe: scan.timeframe,
      direction: 'long',
      levels,
      confidence: Math.max(0, Math.min(MAX_CONFIDENCE, confidence)),
      confidenceComponents: components,
      explanation,
      warnings: scan.warnings,
      basedOn: { score: scan.score, candleCount: scan.candleCount },
    },
  };
}

/**
 * MEAN REVERSION — the opposite premise to production.
 *
 * Buys statistical stretch to the downside expecting a bounce, rather than
 * buying strength. Requires oversold RSI, price at or below the lower Bollinger
 * band, and a calm-enough tape that the stretch is noise rather than a
 * collapse. Explicitly refuses when the trend is strongly down: "oversold" in a
 * genuine crash is not a bounce setup, it is a falling knife, and that
 * distinction is the whole risk of this family.
 */
export function meanReversionSignal(scan: ScanResult, floor: number): SignalDecision {
  const { rsi, percentB, adx, minusDi, plusDi } = scan.snapshot;
  if (rsi === null || percentB === null) return reject(scan, 'mean reversion needs RSI and %B');

  if (rsi > 30) return reject(scan, `RSI ${rsi.toFixed(0)} is not oversold (needs <= 30)`);
  if (percentB > 0.05) {
    return reject(scan, `%B ${percentB.toFixed(2)} is not at the lower band (needs <= 0.05)`);
  }
  // A strong, established downtrend turns "oversold" into "still falling".
  if (adx !== null && adx > 35 && minusDi !== null && plusDi !== null && minusDi > plusDi) {
    return reject(scan, `strong downtrend (ADX ${adx.toFixed(0)}) — oversold here is a falling knife`);
  }

  // Deeper stretch = more conviction, capped so it never reads as certainty.
  const stretch = Math.min(30, (30 - rsi) * 2);
  const confidence = 30 + stretch;
  if (confidence < floor) {
    return reject(scan, `confidence ${confidence.toFixed(0)} is below the required ${floor}`);
  }

  const components: ConfidenceComponent[] = [
    { label: 'Oversold RSI', detail: `RSI ${rsi.toFixed(1)}`, effect: stretch },
    { label: 'At lower Bollinger band', detail: `%B ${percentB.toFixed(2)}`, effect: 30 },
  ];
  return opportunity(
    scan,
    confidence,
    components,
    `Mean reversion: ${scan.symbol} is stretched below its lower band with RSI ` +
      `${rsi.toFixed(1)}, and the tape is not in a strong downtrend. This bets on a ` +
      `bounce, so it is wrong precisely when a fall keeps going.`,
  );
}

/**
 * BREAKOUT — buys expansion out of quiet, rather than existing momentum.
 *
 * Requires the Bollinger bandwidth to be narrow (a coiled, low-volatility base),
 * price pushing through the upper band, and real volume behind it. The premise
 * is that moves begin from compression; the production signal by contrast buys
 * trends already underway, by which point much of the move may be gone.
 */
export function breakoutSignal(scan: ScanResult, floor: number): SignalDecision {
  const { percentB, bollingerBandwidth, relativeVolume, rsi } = scan.snapshot;
  if (percentB === null || bollingerBandwidth === null) {
    return reject(scan, 'breakout needs %B and bandwidth');
  }

  if (bollingerBandwidth > 8) {
    return reject(scan, `bandwidth ${bollingerBandwidth.toFixed(1)}% is not a coiled base (needs <= 8%)`);
  }
  if (percentB < 0.95) {
    return reject(scan, `%B ${percentB.toFixed(2)} has not cleared the upper band (needs >= 0.95)`);
  }
  if (relativeVolume !== null && relativeVolume < 1.2) {
    return reject(scan, `relative volume ${relativeVolume.toFixed(2)} is too thin to confirm a breakout`);
  }
  // A breakout that is already extremely overbought is a chase, not an entry.
  if (rsi !== null && rsi > 80) return reject(scan, `RSI ${rsi.toFixed(0)} — already extended`);

  const tightness = Math.min(25, (8 - bollingerBandwidth) * 4);
  const volumeBoost = relativeVolume === null ? 0 : Math.min(20, (relativeVolume - 1) * 20);
  const confidence = 25 + tightness + volumeBoost;
  if (confidence < floor) {
    return reject(scan, `confidence ${confidence.toFixed(0)} is below the required ${floor}`);
  }

  const components: ConfidenceComponent[] = [
    { label: 'Coiled base', detail: `bandwidth ${bollingerBandwidth.toFixed(1)}%`, effect: tightness },
    {
      label: 'Volume confirmation',
      detail: `relative volume ${relativeVolume === null ? 'n/a' : relativeVolume.toFixed(2)}`,
      effect: volumeBoost,
    },
  ];
  return opportunity(
    scan,
    confidence,
    components,
    `Breakout: ${scan.symbol} pushed through its upper band out of a ` +
      `${bollingerBandwidth.toFixed(1)}% base on above-average volume. This bets that ` +
      `compression precedes expansion, so it is wrong when the break fails back inside.`,
  );
}
