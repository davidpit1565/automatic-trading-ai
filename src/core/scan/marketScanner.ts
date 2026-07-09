/**
 * Market Scanner — Monitoring layer.
 *
 * Computes an indicator snapshot per symbol using the Stage 1 indicator
 * engine (single source of indicator math), scores it with transparent
 * weighted components, and classifies each market hot / neutral / cold.
 *
 * The score measures *directional evidence*, not certainty: every component
 * is reported with its value and contribution so the UI can explain exactly
 * why a market is rated the way it is. A scan is an observation, never a
 * promise.
 */

import type { Candle, Result, Timeframe } from '../types';
import { err, ok } from '../types';
import type { MarketDataSource } from '../data/revolutClient';
import {
  adx,
  atr,
  bollinger,
  ema,
  lastValue,
  macd,
  relativeVolume,
  rsi,
  stochastic,
} from '../indicators';

export type Temperature = 'hot' | 'neutral' | 'cold';

export interface ScanComponent {
  /** Human-readable component name, e.g. "Trend (EMA 20/50)". */
  readonly label: string;
  /** The underlying indicator reading shown to the user. */
  readonly detail: string;
  /** Contribution in score points (positive = bullish, negative = bearish). */
  readonly contribution: number;
}

export interface IndicatorSnapshot {
  readonly price: number;
  readonly changePct: number;
  readonly rsi: number | null;
  readonly macdHistogram: number | null;
  readonly emaFast: number | null;
  readonly emaSlow: number | null;
  readonly adx: number | null;
  readonly plusDi: number | null;
  readonly minusDi: number | null;
  readonly atrPct: number | null;
  readonly bollingerBandwidth: number | null;
  readonly percentB: number | null;
  readonly stochasticK: number | null;
  readonly stochasticD: number | null;
  readonly relativeVolume: number | null;
}

export interface ScanResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candleCount: number;
  /** Composite score in [-100, 100]; sign = direction, magnitude = evidence. */
  readonly score: number;
  readonly temperature: Temperature;
  readonly snapshot: IndicatorSnapshot;
  readonly components: ScanComponent[];
  readonly warnings: string[];
}

export interface ScannerConfig {
  readonly emaFastPeriod: number;
  readonly emaSlowPeriod: number;
  readonly rsiPeriod: number;
  readonly adxPeriod: number;
  readonly atrPeriod: number;
  readonly stochasticKPeriod: number;
  readonly stochasticDPeriod: number;
  readonly volumePeriod: number;
  readonly bollingerPeriod: number;
  /** Minimum candles required for a trustworthy scan. */
  readonly minCandles: number;
  /** Score at or above which a market is 'hot' (mirrored for 'cold'). */
  readonly hotThreshold: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  emaFastPeriod: 20,
  emaSlowPeriod: 50,
  rsiPeriod: 14,
  adxPeriod: 14,
  atrPeriod: 14,
  stochasticKPeriod: 14,
  stochasticDPeriod: 3,
  volumePeriod: 20,
  bollingerPeriod: 20,
  minCandles: 60,
  hotThreshold: 30,
};

/** Component weights in score points; they sum to 100. */
const WEIGHTS = {
  trend: 30,
  rsi: 20,
  macd: 20,
  stochastic: 15,
  volume: 15,
} as const;

/** ADX below this means "no meaningful trend" and damps the trend component. */
const ADX_TRENDING_LEVEL = 25;
/** Bollinger bandwidth above this is flagged as unusually volatile. */
const EXTREME_BANDWIDTH = 0.2;

const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

export function scanCandles(
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
  config: ScannerConfig = DEFAULT_SCANNER_CONFIG,
): Result<ScanResult> {
  if (candles.length < config.minCandles) {
    return err(
      `${symbol}: need at least ${config.minCandles} candles for a reliable scan, got ${candles.length}`,
    );
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const firstClose = closes[0]!;

  const emaFastSeries = ema(closes, config.emaFastPeriod);
  const emaSlowSeries = ema(closes, config.emaSlowPeriod);
  const rsiSeries = rsi(closes, config.rsiPeriod);
  const macdSeries = macd(closes);
  const adxSeries = adx(candles, config.adxPeriod);
  const atrSeries = atr(candles, config.atrPeriod);
  const stochSeries = stochastic(candles, config.stochasticKPeriod, config.stochasticDPeriod);
  const bollingerSeries = bollinger(closes, config.bollingerPeriod);
  const relVolSeries = relativeVolume(candles, config.volumePeriod);

  const atrValue = lastValue(atrSeries);
  const snapshot: IndicatorSnapshot = {
    price,
    changePct: firstClose !== 0 ? ((price - firstClose) / firstClose) * 100 : 0,
    rsi: lastValue(rsiSeries),
    macdHistogram: lastValue(macdSeries.histogram),
    emaFast: lastValue(emaFastSeries),
    emaSlow: lastValue(emaSlowSeries),
    adx: lastValue(adxSeries.adx),
    plusDi: lastValue(adxSeries.plusDi),
    minusDi: lastValue(adxSeries.minusDi),
    atrPct: atrValue !== null && price !== 0 ? (atrValue / price) * 100 : null,
    bollingerBandwidth: lastValue(bollingerSeries.bandwidth),
    percentB: lastValue(bollingerSeries.percentB),
    stochasticK: lastValue(stochSeries.k),
    stochasticD: lastValue(stochSeries.d),
    relativeVolume: lastValue(relVolSeries),
  };

  const components: ScanComponent[] = [];
  const warnings: string[] = [];

  // Trend: EMA separation normalised by price, confidence-scaled by ADX.
  if (snapshot.emaFast !== null && snapshot.emaSlow !== null && price !== 0) {
    const separation = (snapshot.emaFast - snapshot.emaSlow) / price;
    // ±2% separation saturates the raw signal.
    const raw = clamp(separation / 0.02, -1, 1);
    const adxFactor = snapshot.adx === null ? 0.5 : clamp(snapshot.adx / ADX_TRENDING_LEVEL, 0, 1);
    const contribution = raw * adxFactor * WEIGHTS.trend;
    components.push({
      label: `Trend (EMA ${config.emaFastPeriod}/${config.emaSlowPeriod} + ADX)`,
      detail:
        `EMA${config.emaFastPeriod} ${formatNumber(snapshot.emaFast)} vs ` +
        `EMA${config.emaSlowPeriod} ${formatNumber(snapshot.emaSlow)}, ` +
        `ADX ${snapshot.adx === null ? 'n/a' : snapshot.adx.toFixed(1)}`,
      contribution,
    });
  }

  // Momentum: RSI distance from the 50 midline.
  if (snapshot.rsi !== null) {
    const contribution = ((snapshot.rsi - 50) / 50) * WEIGHTS.rsi;
    components.push({
      label: `Momentum (RSI ${config.rsiPeriod})`,
      detail: `RSI ${snapshot.rsi.toFixed(1)}`,
      contribution,
    });
    if (snapshot.rsi >= 70) warnings.push(`RSI ${snapshot.rsi.toFixed(1)} is overbought (≥ 70)`);
    if (snapshot.rsi <= 30) warnings.push(`RSI ${snapshot.rsi.toFixed(1)} is oversold (≤ 30)`);
  }

  // Momentum confirmation: MACD histogram normalised by ATR (scale-free).
  if (snapshot.macdHistogram !== null && atrValue !== null && atrValue > 0) {
    const raw = clamp(snapshot.macdHistogram / atrValue, -1, 1);
    const contribution = raw * WEIGHTS.macd;
    components.push({
      label: 'MACD histogram',
      detail: `histogram ${formatNumber(snapshot.macdHistogram)} (ATR-normalised ${raw.toFixed(2)})`,
      contribution,
    });
  }

  // Stochastic position within its range.
  if (snapshot.stochasticK !== null) {
    const contribution = ((snapshot.stochasticK - 50) / 50) * WEIGHTS.stochastic;
    components.push({
      label: `Stochastic %K ${config.stochasticKPeriod}`,
      detail: `%K ${snapshot.stochasticK.toFixed(1)}`,
      contribution,
    });
  }

  // Volume: above-average volume amplifies the current candle's direction.
  if (snapshot.relativeVolume !== null) {
    const lastCandle = candles[candles.length - 1]!;
    const direction = Math.sign(lastCandle.close - lastCandle.open);
    const excess = clamp(snapshot.relativeVolume - 1, -1, 1);
    const contribution = direction * Math.max(excess, 0) * WEIGHTS.volume;
    components.push({
      label: `Volume (vs ${config.volumePeriod}-bar average)`,
      detail: `relative volume ${snapshot.relativeVolume.toFixed(2)}×`,
      contribution,
    });
  }

  if (snapshot.bollingerBandwidth !== null && snapshot.bollingerBandwidth > EXTREME_BANDWIDTH) {
    warnings.push(
      `Bollinger bandwidth ${(snapshot.bollingerBandwidth * 100).toFixed(1)}% — unusually volatile`,
    );
  }
  if (snapshot.adx !== null && snapshot.adx < ADX_TRENDING_LEVEL) {
    warnings.push(`ADX ${snapshot.adx.toFixed(1)} < ${ADX_TRENDING_LEVEL} — weak/absent trend`);
  }

  const score = clamp(
    components.reduce((sum, c) => sum + c.contribution, 0),
    -100,
    100,
  );
  const temperature: Temperature =
    score >= config.hotThreshold ? 'hot' : score <= -config.hotThreshold ? 'cold' : 'neutral';

  return ok({
    symbol,
    timeframe,
    candleCount: candles.length,
    score,
    temperature,
    snapshot,
    components,
    warnings,
  });
}

export interface MarketScan {
  readonly timeframe: Timeframe;
  readonly results: ScanResult[];
  /** Symbols that could not be scanned, with the reason — never silent. */
  readonly failures: { readonly symbol: string; readonly reason: string }[];
}

/** Scan a list of symbols from a data source; sorted by score descending. */
export async function scanMarket(
  source: MarketDataSource,
  symbols: readonly string[],
  timeframe: Timeframe,
  candleLimit = 150,
  config: ScannerConfig = DEFAULT_SCANNER_CONFIG,
): Promise<MarketScan> {
  const results: ScanResult[] = [];
  const failures: { symbol: string; reason: string }[] = [];

  const settled = await Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      candles: await source.getCandles(symbol, timeframe, candleLimit),
    })),
  );

  for (const { symbol, candles } of settled) {
    if (!candles.ok) {
      failures.push({ symbol, reason: candles.error });
      continue;
    }
    const scan = scanCandles(symbol, timeframe, candles.value, config);
    if (scan.ok) results.push(scan.value);
    else failures.push({ symbol, reason: scan.error });
  }

  results.sort((a, b) => b.score - a.score);
  return { timeframe, results, failures };
}

function formatNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}
