/**
 * Deterministic synthetic market data.
 *
 * Used for the dashboard's clearly-labelled demo mode (when the live API is
 * unreachable, e.g. CORS or offline) and for reproducible tests. Seeded PRNG
 * so the same seed always yields the same series — never presented as real
 * market data.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { ok, TIMEFRAME_MS } from '../types';
import type { MarketDataSource } from './revolutClient';

/** Mulberry32: small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface SyntheticSeriesOptions {
  seed: number;
  startPrice: number;
  count: number;
  timeframe: Timeframe;
  /** Candle open time of the first candle (epoch ms). */
  startTimestamp: number;
  /** Per-candle drift as a fraction, e.g. 0.0005 = gentle uptrend. */
  drift?: number;
  /** Per-candle volatility as a fraction of price. */
  volatility?: number;
  baseVolume?: number;
}

/** Generate a deterministic OHLCV random-walk series with valid invariants. */
export function generateSyntheticCandles(options: SyntheticSeriesOptions): Candle[] {
  const {
    seed,
    startPrice,
    count,
    timeframe,
    startTimestamp,
    drift = 0,
    volatility = 0.01,
    baseVolume = 1000,
  } = options;
  const rand = mulberry32(seed);
  const step = TIMEFRAME_MS[timeframe];
  const candles: Candle[] = [];
  let previousClose = startPrice;

  for (let i = 0; i < count; i++) {
    const open = previousClose;
    const shock = (rand() * 2 - 1) * volatility;
    const close = Math.max(open * (1 + drift + shock), 0.000001);
    const wickUp = rand() * volatility * open;
    const wickDown = rand() * volatility * open;
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(Math.min(open, close) - wickDown, 0.000001);
    const volume = baseVolume * (0.5 + rand());
    candles.push({
      timestamp: startTimestamp + i * step,
      open,
      high,
      low,
      close,
      volume,
    });
    previousClose = close;
  }
  return candles;
}

const DEMO_INSTRUMENTS: Instrument[] = [
  { symbol: 'BTC/USD', base: 'BTC', quote: 'USD' },
  { symbol: 'ETH/USD', base: 'ETH', quote: 'USD' },
  { symbol: 'SOL/USD', base: 'SOL', quote: 'USD' },
  { symbol: 'XRP/USD', base: 'XRP', quote: 'USD' },
  { symbol: 'ADA/USD', base: 'ADA', quote: 'USD' },
  { symbol: 'DOGE/USD', base: 'DOGE', quote: 'USD' },
  { symbol: 'LTC/USD', base: 'LTC', quote: 'USD' },
  { symbol: 'DOT/USD', base: 'DOT', quote: 'USD' },
];

const DEMO_START_PRICE: Record<string, number> = {
  'BTC/USD': 65_000,
  'ETH/USD': 3_400,
  'SOL/USD': 150,
  'XRP/USD': 0.52,
  'ADA/USD': 0.45,
  'DOGE/USD': 0.12,
  'LTC/USD': 82,
  'DOT/USD': 6.4,
};

/** Give different demo symbols different regimes so the scanner has variety. */
const DEMO_DRIFT: Record<string, number> = {
  'BTC/USD': 0.0012,
  'ETH/USD': 0.0008,
  'SOL/USD': 0.002,
  'XRP/USD': -0.0012,
  'ADA/USD': -0.002,
  'DOGE/USD': 0.0001,
  'LTC/USD': -0.0003,
  'DOT/USD': 0.0004,
};

export class SyntheticDataSource implements MarketDataSource {
  readonly name = 'Demo data (synthetic)';

  /** Anchor time injected so generation stays deterministic and testable. */
  constructor(private readonly anchorTimestamp: number) {}

  getInstruments(): Promise<Result<Instrument[]>> {
    return Promise.resolve(ok([...DEMO_INSTRUMENTS]));
  }

  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Result<Candle[]>> {
    const step = TIMEFRAME_MS[timeframe];
    const startTimestamp = this.anchorTimestamp - limit * step;
    const candles = generateSyntheticCandles({
      seed: hashSeed(`${symbol}:${timeframe}`),
      startPrice: DEMO_START_PRICE[symbol] ?? 100,
      count: limit,
      timeframe,
      startTimestamp,
      drift: DEMO_DRIFT[symbol] ?? 0,
      volatility: 0.015,
      baseVolume: 5_000,
    });
    return Promise.resolve(ok(candles));
  }
}
