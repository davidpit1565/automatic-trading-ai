/**
 * Extended-history fetcher — pages Kraken's public OHLC endpoint backward in
 * time to assemble far more history than a single call can return.
 *
 * Kraken's `/OHLC` caps a single response at roughly 720 rows regardless of
 * the `limit` `KrakenPublicSource.getCandles` is asked for (that cap is
 * Kraken's, not this codebase's). `KrakenPublicSource`'s `now: () => number`
 * constructor option drives the `since` parameter it computes internally, so
 * repeatedly calling `getCandles` with a progressively earlier virtual "now"
 * pages backward: each call's `since` lands further into the past, and
 * Kraken returns the ~720-row window ending around that virtual now.
 *
 * A single shared `KrakenPublicSource` (one request queue, one stagger) is
 * used for every symbol/timeframe/chunk — exactly the serialised, rate-
 * limited behaviour the source already implements. This module only ever
 * changes WHAT time it asks for, never how many requests are in flight.
 *
 * Fetched chunks are cached to `.cache/prop-replay/<symbol>-<timeframe>.json`
 * so re-running the script during development doesn't refetch from Kraken.
 * Honesty over aspiration: when Kraken has less history than requested for a
 * pair (common for newer listings), pagination naturally stops (no older
 * rows come back) and the result says exactly how much was fetched and that
 * it's exhausted — callers must use that real amount, never pad it.
 *
 * MEASURED LIMIT (2026-09-07, verified live against api.kraken.com, every
 * pair and interval tried behaves the same): Kraken's public `/OHLC` ignores
 * how far in the past `since` is once the requested window exceeds its
 * response cap — it always returns the ~721 MOST RECENT candles relative to
 * Kraken's own real clock, never an older window. `since` only narrows the
 * response when the requested span is SMALLER than the cap (e.g. `since` 10
 * days ago on 1h candles correctly returns ~240 rows). Practically this
 * means the backward-pagination loop below discovers `exhausted: true` after
 * exactly one probe past the initial seed, for every symbol, on every run —
 * there is no live "now" trick that unlocks more than the cap's worth of
 * calendar depth (~30 days at 1h interval=60, ~120 days at 4h interval=240,
 * ~2 years at 1d interval=1440 — confirmed by direct probe at each interval).
 * The pagination machinery is kept (and does the right, honest thing —
 * reports `exhausted` rather than looping forever or fabricating depth)
 * because it costs nothing to keep general, and because it would start
 * working immediately if Kraken ever changes this or against any other
 * `since`-style source that honours an older window. For 1h history beyond
 * ~30 days, a different data source (Kraken's authenticated bulk OHLC
 * export, or a paid historical data vendor) would be required — out of
 * scope for this zero-cost, keyless tool.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KrakenPublicSource } from '../../src/core/data/krakenPublic';
import type { Candle, Timeframe } from '../../src/core/types';

const CACHE_DIR = path.resolve(process.cwd(), '.cache/prop-replay');
const DEFAULT_CHUNK_LIMIT = 720;
const DEFAULT_MAX_ITERATIONS = 60;

interface CacheFile {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candles: Candle[];
  /** True once backward pagination hit Kraken's real earliest data for this pair. */
  readonly exhausted: boolean;
  readonly fetchedAt: number;
}

export interface FetchExtendedHistoryResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candles: readonly Candle[];
  readonly exhausted: boolean;
  readonly iterationsThisRun: number;
  readonly fromCache: boolean;
  /** Set only when even the initial fetch failed (candles will be empty). */
  readonly error?: string;
}

export interface HistoryFetcher {
  fetchSymbolHistory(
    symbol: string,
    timeframe: Timeframe,
    targetBars: number,
    opts?: { readonly chunkLimit?: number; readonly maxIterations?: number },
  ): Promise<FetchExtendedHistoryResult>;
}

function cachePath(symbol: string, timeframe: Timeframe): string {
  return path.join(CACHE_DIR, `${symbol}-${timeframe}.json`);
}

async function loadCache(symbol: string, timeframe: Timeframe): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath(symbol, timeframe), 'utf8');
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

async function saveCache(file: CacheFile): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(file.symbol, file.timeframe), JSON.stringify(file), 'utf8');
}

/** Merge two candle arrays, de-duplicating by timestamp, ascending order. */
function mergeAscendingUnique(existing: readonly Candle[], added: readonly Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const c of existing) byTimestamp.set(c.timestamp, c);
  for (const c of added) byTimestamp.set(c.timestamp, c);
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * One shared, rate-limited `KrakenPublicSource` for the whole fetch run, plus
 * a mutable "virtual now" that `fetchSymbolHistory` moves backward per
 * symbol between chunks (sequentially — never concurrently).
 */
export function createHistoryFetcher(): HistoryFetcher {
  const clock = { virtualNowMs: Date.now() };
  const source = new KrakenPublicSource({ now: () => clock.virtualNowMs });

  async function fetchSymbolHistory(
    symbol: string,
    timeframe: Timeframe,
    targetBars: number,
    opts: { chunkLimit?: number; maxIterations?: number } = {},
  ): Promise<FetchExtendedHistoryResult> {
    const chunkLimit = opts.chunkLimit ?? DEFAULT_CHUNK_LIMIT;
    const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    const cached = await loadCache(symbol, timeframe);
    let candles = cached?.candles ?? [];
    let exhausted = cached?.exhausted ?? false;
    let iterations = 0;
    const alreadySatisfied = candles.length >= targetBars || exhausted;

    if (!alreadySatisfied) {
      if (candles.length === 0) {
        clock.virtualNowMs = Date.now();
        const seed = await source.getCandles(symbol, timeframe, chunkLimit);
        iterations++;
        if (!seed.ok) {
          return {
            symbol,
            timeframe,
            candles: [],
            exhausted: false,
            iterationsThisRun: iterations,
            fromCache: false,
            error: seed.error,
          };
        }
        candles = mergeAscendingUnique(candles, seed.value);
      }

      while (!exhausted && candles.length < targetBars && iterations < maxIterations) {
        const earliest = candles[0]!.timestamp;
        clock.virtualNowMs = earliest;
        const chunk = await source.getCandles(symbol, timeframe, chunkLimit);
        iterations++;
        if (!chunk.ok) break; // transient failure this run; not exhausted, retry next run
        const older = chunk.value.filter((c) => c.timestamp < earliest);
        if (older.length === 0) {
          exhausted = true;
          break;
        }
        candles = mergeAscendingUnique(candles, older);
      }

      await saveCache({ symbol, timeframe, candles, exhausted, fetchedAt: Date.now() });
    }

    return {
      symbol,
      timeframe,
      candles,
      exhausted,
      iterationsThisRun: iterations,
      fromCache: alreadySatisfied,
    };
  }

  return { fetchSymbolHistory };
}
