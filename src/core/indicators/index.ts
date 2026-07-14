/**
 * Indicator Engine — Stage 1.
 *
 * Pure, reusable functions. No I/O, no state, no UI knowledge.
 * Every function returns arrays aligned 1:1 with its input, `null` during
 * warm-up. This is the single source of indicator math for the whole
 * platform — strategies, scanner and UI must all import from here.
 */

export { sma } from './sma';
export { ema } from './ema';
export { rsi } from './rsi';
export { macd, type MacdResult } from './macd';
export { bollinger, type BollingerResult } from './bollinger';
export { atr, trueRange } from './atr';
export { adx, type AdxResult } from './adx';
export { stochastic, type StochasticResult } from './stochastic';
export { obv, relativeVolume, volumeSma } from './volume';

/** Last non-null value of an indicator series, or null if none. */
export function lastValue(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}
