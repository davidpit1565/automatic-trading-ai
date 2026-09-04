/**
 * Kraken public market data source.
 *
 * Browser-direct, keyless, CORS-open (verified) — this is what lets the
 * platform run with REAL market data on a phone, with no local proxy and
 * no credentials. Read-only by construction like every data source here.
 *
 * API: GET https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=60
 * Response: { error: [], result: { <PAIRKEY>: rows, last } } where each row
 * is [timeSec, open, high, low, close, vwap, volume, count] — note vwap at
 * index 5 (dropped) and volume at index 6. The result key can differ from
 * the requested pair (XBTEUR -> XXBTZEUR), so the first non-`last` key wins.
 *
 * Prices on Kraken can differ slightly from Revolut X — the UI labels the
 * active source so this is never hidden.
 */

import type { Candle, Instrument, Result, Ticker, Timeframe } from '../types';
import { err, ok } from '../types';
import { parseCandleSeries } from './candles';
import type { MarketDataSource } from './revolutClient';

const BASE_URL = 'https://api.kraken.com/0/public';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Pause between requests — Kraken's public rate limits are per IP. */
const DEFAULT_STAGGER_MS = 150;

/** Kraken expresses intervals in whole minutes; 1:1 with our timeframes. */
const INTERVAL_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10_080,
};

/**
 * Curated majors, EUR-quoted. Kraken names Bitcoin XBT; we display BTC.
 * TRADED by the agent (`server/autopilotRunner.mts` trades exactly
 * `instruments.slice(0, CURATED_INSTRUMENTS.length)` — derives the count
 * from this array's own length, not a hardcoded number, since 2026-09-04)
 * — this order is load-bearing. Do NOT reorder or insert above this line;
 * broadening the browsable universe happens by appending more instruments
 * after it (see `getInstruments` below), never by changing what these
 * curated ones are.
 *
 * The first 10 (XBT…AVAX) are the original measured majors. UNI/FIL/AAVE/
 * ATOM/XLM/ALGO were added 2026-09-03 after measuring each candidate on real
 * Kraken history through the live decision pipeline (`validateStrategy.mts`,
 * ~720 1h candles): all six were net-positive (best: UNI +6.23%, PF 2.49,
 * 14 trades; weakest of the six: ALGO +0.88%, PF 1.77) — comparable to or
 * better than the weakest of the original 10 (DOT -0.33%, AVAX -0.06%), so
 * excluded as an inconsistent bar. ETC (-0.16%, PF 0.91) and NEAR (-0.99%,
 * PF 0.79) measured net-negative on the same run and were deliberately left
 * out; BCH/TRX measured only marginally positive on very few trades (5 and 3)
 * — too thin to call either way — and were left out pending more data rather
 * than included on a coin-flip sample.
 *
 * HNT/VELO/AERO/ENA were added 2026-09-03 (same day, second batch) after
 * David asked why the agent hadn't caught that day's biggest small-cap
 * gainers (HNT/FORTH/AERGO/GHST/VELO/XPL/ARB/ENA/HIGH/AERO, all 10-35%+ on
 * the day) — measured the 8 of those with a Kraken EUR pair the same way:
 * HNT +1.49% (PF 1.38, 11t), VELO +3.98% (PF 1.87, 12t), AERO +2.57%
 * (PF 1.95, 10t) and ENA +1.61% (PF 1.73, 6t — thinner sample, included as
 * borderline-acceptable, not a strong signal on its own) all net-positive
 * on a real sample. GHST (-1.47%, PF 0.18) and XPL (-0.19%, PF 0.95)
 * measured net-negative and were left out. FORTH (+1.86%, but only 3
 * trades) and ARB (+6.02%/100% win, but only 5 trades — the exact
 * small-sample "100% win rate" pattern that isn't a real signal) were
 * excluded on the same too-thin-to-call basis as BCH/TRX above, despite
 * ARB's flashy headline number — chasing a single day's biggest gainers by
 * their raw daily % move is a known losing pattern (buying the pump); only
 * the four that held up over ~720 hours of real decision-pipeline replay
 * were added.
 */
export const CURATED_INSTRUMENTS: Instrument[] = [
  { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' },
  { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' },
  { symbol: 'SOLEUR', base: 'SOL', quote: 'EUR' },
  { symbol: 'XRPEUR', base: 'XRP', quote: 'EUR' },
  { symbol: 'ADAEUR', base: 'ADA', quote: 'EUR' },
  { symbol: 'DOGEEUR', base: 'DOGE', quote: 'EUR' },
  { symbol: 'LTCEUR', base: 'LTC', quote: 'EUR' },
  { symbol: 'DOTEUR', base: 'DOT', quote: 'EUR' },
  { symbol: 'LINKEUR', base: 'LINK', quote: 'EUR' },
  { symbol: 'AVAXEUR', base: 'AVAX', quote: 'EUR' },
  { symbol: 'UNIEUR', base: 'UNI', quote: 'EUR' },
  { symbol: 'FILEUR', base: 'FIL', quote: 'EUR' },
  { symbol: 'AAVEEUR', base: 'AAVE', quote: 'EUR' },
  { symbol: 'ATOMEUR', base: 'ATOM', quote: 'EUR' },
  { symbol: 'XLMEUR', base: 'XLM', quote: 'EUR' },
  { symbol: 'ALGOEUR', base: 'ALGO', quote: 'EUR' },
  { symbol: 'HNTEUR', base: 'HNT', quote: 'EUR' },
  { symbol: 'VELOEUR', base: 'VELO', quote: 'EUR' },
  { symbol: 'AEROEUR', base: 'AERO', quote: 'EUR' },
  { symbol: 'ENAEUR', base: 'ENA', quote: 'EUR' },
];

/** Base asset codes (BTC, ETH, …) actually traded by the agent — for the UI's
 * "TRADED" badge (Markets list, Home's Markets rail widget). Compared by
 * base rather than symbol since the display data source can be Kraken,
 * Coinbase, Revolut or synthetic demo data, each with its own pair-symbol
 * format, while the base code (what a coin is actually called) is the same
 * across all of them. */
export const CURATED_BASES: ReadonlySet<string> = new Set(CURATED_INSTRUMENTS.map((i) => i.base));

/**
 * Kraken's internal asset codes for assets the rest of the world names
 * differently. Verified against the live AssetPairs list: of the sixteen curated
 * majors, only these two differ. Without the mapping the curated entry and the
 * discovered entry look like two separate assets, and the coin is listed twice
 * — once under its real name, once under Kraken's code.
 */
const ASSET_ALIASES: Readonly<Record<string, string>> = {
  XBT: 'BTC',
  XDG: 'DOGE',
};

/** Curated symbol per asset code, so a discovered pair reuses it rather than duplicating. */
const CURATED_SYMBOL_BY_BASE = new Map(CURATED_INSTRUMENTS.map((i) => [i.base, i.symbol]));

/**
 * Static DISPLAY-only fallback, used only when the live AssetPairs call
 * (see `fetchEurPairs`) fails — so a transient network error never shrinks
 * the browsable list back down to just the 16 curated majors. Each entry
 * verified live on Kraken. PAXG is a gold-backed token (tracks gold, not
 * physical metal).
 */
const FALLBACK_DISPLAY_INSTRUMENTS: Instrument[] = [
  { symbol: 'POLEUR', base: 'POL', quote: 'EUR' },
  { symbol: 'TRXEUR', base: 'TRX', quote: 'EUR' },
  { symbol: 'BCHEUR', base: 'BCH', quote: 'EUR' },
  { symbol: 'ETCEUR', base: 'ETC', quote: 'EUR' },
  { symbol: 'NEAREUR', base: 'NEAR', quote: 'EUR' },
  { symbol: 'INJEUR', base: 'INJ', quote: 'EUR' },
  { symbol: 'ARBEUR', base: 'ARB', quote: 'EUR' },
  { symbol: 'OPEUR', base: 'OP', quote: 'EUR' },
  { symbol: 'APTEUR', base: 'APT', quote: 'EUR' },
  { symbol: 'PAXGEUR', base: 'PAXG', quote: 'EUR' },
];

export interface KrakenPublicSourceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Delay between queued requests; lower only in tests. */
  staggerMs?: number;
}

/** One pending request waiting for its turn in the serial queue. */
interface QueuedTask {
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/** One price level in an order book, closest-to-mid first. */
export interface OrderBookLevel {
  readonly price: number;
  readonly volume: number;
}
export interface OrderBook {
  readonly bids: OrderBookLevel[];
  readonly asks: OrderBookLevel[];
}
export interface RecentTrade {
  readonly price: number;
  readonly volume: number;
  readonly time: number;
  readonly side: 'buy' | 'sell';
}

export class KrakenPublicSource implements MarketDataSource {
  readonly name = 'Kraken public market data (read-only)';
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly staggerMs: number;
  /**
   * Serialises all requests one-at-a-time (Kraken rate-limits per IP) via a
   * real task queue rather than a promise chain, so a `priority` request
   * (the chart a user just opened) can jump ahead of already-queued
   * background work (e.g. the Markets list's ~26-coin sweep) instead of
   * waiting behind all of it — that queue-starvation was why an interactive
   * chart could take 8+ seconds and time out even though Kraken itself
   * answers a full concurrent burst in about a second (measured).
   */
  private readonly pending: QueuedTask[] = [];
  private draining = false;
  private instrumentsCache: Instrument[] | null = null;
  /**
   * Kraken's internal pair key -> the symbol we actually display
   * (XXBTZEUR -> XBTEUR, XDGEUR -> DOGEEUR). `/Ticker` is keyed by the
   * internal id while everything else here speaks altnames, and the two
   * differ for the older pairs. Built from the same AssetPairs response that
   * discovers instruments — verified 535/535 keys line up — so no guessing or
   * string-munging is involved.
   */
  private pairKeyToSymbol: Map<string, string> | null = null;

  constructor(options: KrakenPublicSourceOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  }

  /**
   * The curated 16 majors always lead, in their fixed order (what the agent
   * trades). Appended after them: every other EUR pair Kraken currently
   * lists live, broadening the BROWSABLE universe — or, if that live call
   * fails, the static fallback list, so browsing never regresses. Cached
   * for the life of this source (one network round trip, not one per call).
   */
  async getInstruments(): Promise<Result<Instrument[]>> {
    if (this.instrumentsCache) return ok([...this.instrumentsCache]);
    const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));
    const dynamic = await this.fetchEurPairs();
    const extra = (dynamic.ok ? dynamic.value : FALLBACK_DISPLAY_INSTRUMENTS).filter(
      (i) => !curatedSymbols.has(i.symbol),
    );
    const merged = [...CURATED_INSTRUMENTS, ...extra];
    this.instrumentsCache = merged;
    return ok([...merged]);
  }

  /** Every currently-tradeable EUR pair from Kraken's public AssetPairs list. */
  private async fetchEurPairs(): Promise<Result<Instrument[]>> {
    const payload = await this.enqueue(() => this.getJson(`${BASE_URL}/AssetPairs`), true);
    if (!payload.ok) return payload;
    const raw = payload.value as { error?: unknown[]; result?: Record<string, unknown> };
    if (Array.isArray(raw.error) && raw.error.length > 0) {
      return err(`Kraken error: ${raw.error.join('; ')}`);
    }
    const result = raw.result;
    if (typeof result !== 'object' || result === null) {
      return err('unexpected Kraken payload: no result object');
    }
    const instruments: Instrument[] = [];
    const keyToSymbol = new Map<string, string>();
    for (const [pairKey, value] of Object.entries(result)) {
      const info = value as { altname?: unknown; wsname?: unknown; status?: unknown };
      if (info.status !== 'online' || typeof info.wsname !== 'string' || typeof info.altname !== 'string') continue;
      const [wsBase, wsQuote] = info.wsname.split('/');
      if (wsQuote !== 'EUR' || !wsBase) continue;
      const base = ASSET_ALIASES[wsBase] ?? wsBase;
      // When a curated major already covers this asset, reuse ITS symbol: the
      // caller then dedupes it away, and the agent's trading symbol is left
      // exactly as-is. Otherwise the pair broadens the universe under its own
      // altname.
      const symbol = CURATED_SYMBOL_BY_BASE.get(base) ?? info.altname;
      instruments.push({ symbol, base, quote: 'EUR' });
      keyToSymbol.set(pairKey, symbol);
    }
    if (instruments.length === 0) return err('no online EUR pairs found in AssetPairs response');
    this.pairKeyToSymbol = keyToSymbol;
    return ok(instruments);
  }

  /**
   * Every EUR market's current price in ONE request (`/Ticker` with no pair
   * argument returns all ~1,500 listed pairs). Replaces one OHLC call per
   * symbol, which is what previously capped the browsable list: a
   * several-hundred-market screen is a single round trip this way.
   *
   * Only pairs present in the EUR instrument map are returned, so the USD and
   * other-quote pairs in the same payload are dropped rather than shown with
   * a euro sign.
   */
  async getTickers(): Promise<Result<Ticker[]>> {
    // Populates pairKeyToSymbol as a side effect; also gives us the cache.
    await this.getInstruments();
    const keyToSymbol = this.pairKeyToSymbol;
    if (!keyToSymbol || keyToSymbol.size === 0) {
      return err('EUR pair map unavailable — cannot map Kraken ticker keys to symbols');
    }
    const payload = await this.enqueue(() => this.getJson(`${BASE_URL}/Ticker`), true);
    if (!payload.ok) return payload;
    const raw = payload.value as { error?: unknown[]; result?: Record<string, unknown> };
    if (Array.isArray(raw.error) && raw.error.length > 0) {
      return err(`Kraken error: ${raw.error.join('; ')}`);
    }
    if (typeof raw.result !== 'object' || raw.result === null) {
      return err('unexpected Kraken payload: no result object');
    }

    const tickers: Ticker[] = [];
    for (const [pairKey, value] of Object.entries(raw.result)) {
      const symbol = keyToSymbol.get(pairKey);
      if (symbol === undefined) continue; // not a EUR pair we list
      const entry = value as {
        c?: unknown; o?: unknown; h?: unknown; l?: unknown; v?: unknown; p?: unknown;
      };
      // Kraken sends every number as a string; arrays are [today, last24h].
      const price = num(first(entry.c));
      const open = num(entry.o);
      if (price === null || open === null) continue; // malformed — skip, never NaN
      const volume = num(last24h(entry.v)) ?? 0;
      const vwap = num(last24h(entry.p)) ?? price;
      tickers.push({
        symbol,
        price,
        open,
        high: num(last24h(entry.h)) ?? price,
        low: num(last24h(entry.l)) ?? price,
        volume,
        quoteVolume: volume * vwap,
      });
    }
    return ok(tickers);
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    opts?: { readonly priority?: boolean },
  ): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const interval = INTERVAL_MINUTES[timeframe];
    // `since` trims the response server-side to roughly the window we need.
    const sinceSec = Math.floor((this.now() - (limit + 2) * interval * 60_000) / 1000);
    const url =
      `${BASE_URL}/OHLC?pair=${encodeURIComponent(symbol)}` +
      `&interval=${interval}&since=${sinceSec}`;

    const payload = await this.enqueue(() => this.getJson(url), opts?.priority ?? false);
    if (!payload.ok) return payload;

    const raw = payload.value as {
      error?: unknown[];
      result?: Record<string, unknown>;
    };
    if (Array.isArray(raw.error) && raw.error.length > 0) {
      return err(`Kraken error: ${raw.error.join('; ')}`);
    }
    const result = raw.result;
    if (typeof result !== 'object' || result === null) {
      return err('unexpected Kraken payload: no result object');
    }
    const pairKey = Object.keys(result).find((key) => key !== 'last');
    const rows = pairKey !== undefined ? result[pairKey] : undefined;
    if (!Array.isArray(rows)) return err('unexpected Kraken payload: no OHLC rows');

    // Remap [t, o, h, l, c, vwap, volume, count] -> [t, o, h, l, c, volume].
    const remapped = rows
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 7)
      .map((row) => [row[0], row[1], row[2], row[3], row[4], row[6]]);
    const { candles, rejected } = parseCandleSeries(remapped);
    if (candles.length === 0) {
      return err(
        rejected.length > 0
          ? `all ${rejected.length} Kraken rows invalid (first: ${rejected[0]?.reason})`
          : 'empty candle series from Kraken',
      );
    }
    return ok(candles.slice(-limit));
  }

  /**
   * Current order book (bid/ask ladder), closest-to-mid first on each side.
   * Not part of `MarketDataSource` — only Kraken (a real public exchange)
   * has a book to show; a synthetic/demo source has nothing meaningful here.
   * Callers feature-detect with `'getOrderBook' in data.source`.
   */
  async getOrderBook(symbol: string, count = 15): Promise<Result<OrderBook>> {
    const url = `${BASE_URL}/Depth?pair=${encodeURIComponent(symbol)}&count=${count}`;
    const payload = await this.enqueue(() => this.getJson(url), true);
    if (!payload.ok) return payload;
    const raw = payload.value as { error?: unknown[]; result?: Record<string, unknown> };
    if (Array.isArray(raw.error) && raw.error.length > 0) return err(`Kraken error: ${raw.error.join('; ')}`);
    const result = raw.result;
    if (typeof result !== 'object' || result === null) return err('unexpected Kraken payload: no result object');
    const pairKey = Object.keys(result)[0];
    const book = pairKey !== undefined ? (result[pairKey] as { asks?: unknown; bids?: unknown }) : undefined;
    if (!book || !Array.isArray(book.asks) || !Array.isArray(book.bids)) {
      return err('unexpected Kraken payload: no order book rows');
    }
    const levels = (rows: unknown[]): OrderBookLevel[] =>
      rows
        .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 2)
        .map((r) => ({ price: num(r[0]) ?? 0, volume: num(r[1]) ?? 0 }))
        .filter((l) => l.price > 0 && l.volume > 0);
    return ok({ bids: levels(book.bids), asks: levels(book.asks) });
  }

  /**
   * Most recent public trades, newest first. Not part of `MarketDataSource`
   * — see `getOrderBook`'s doc comment for why.
   */
  async getRecentTrades(symbol: string, count = 30): Promise<Result<RecentTrade[]>> {
    const url = `${BASE_URL}/Trades?pair=${encodeURIComponent(symbol)}&count=${count}`;
    const payload = await this.enqueue(() => this.getJson(url), true);
    if (!payload.ok) return payload;
    const raw = payload.value as { error?: unknown[]; result?: Record<string, unknown> };
    if (Array.isArray(raw.error) && raw.error.length > 0) return err(`Kraken error: ${raw.error.join('; ')}`);
    const result = raw.result;
    if (typeof result !== 'object' || result === null) return err('unexpected Kraken payload: no result object');
    const pairKey = Object.keys(result).find((key) => key !== 'last');
    const rows = pairKey !== undefined ? result[pairKey] : undefined;
    if (!Array.isArray(rows)) return err('unexpected Kraken payload: no trade rows');
    const trades = rows
      .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 4)
      .map((r): RecentTrade | null => {
        const price = num(r[0]);
        const volume = num(r[1]);
        const time = num(r[2]);
        if (price === null || volume === null || time === null) return null;
        return { price, volume, time: Math.round(time * 1000), side: r[3] === 'b' ? 'buy' : 'sell' };
      })
      .filter((t): t is RecentTrade => t !== null)
      .reverse();
    return ok(trades);
  }

  /**
   * Run a request through the serial queue with a stagger between calls.
   * `priority` jumps ahead of already-queued non-priority work (but never
   * ahead of whatever request is already in flight) — still exactly one
   * request at a time, just reordered so an interactive need is served next.
   */
  private enqueue<T>(task: () => Promise<T>, priority = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueuedTask = { run: task, resolve: resolve as (v: unknown) => void, reject };
      if (priority) this.pending.unshift(item);
      else this.pending.push(item);
      void this.drain();
    });
  }

  /** Processes queued tasks one at a time, staggered, until the queue is empty. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        try {
          item.resolve(await item.run());
        } catch (cause) {
          item.reject(cause);
        }
        if (this.pending.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.staggerMs));
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * One HTTP GET with a bounded retry on transient failures.
   *
   * Kraken answers 429 (rate limited) and 5xx (busy) under load, and observed
   * live: a burst of requests draws a wall of 503s. Without a retry each of
   * those silently drops that symbol from the cycle, so the agent decides on a
   * partial view of the market and the gap never surfaces.
   *
   * Only these transient statuses are retried, with exponential backoff. A 4xx
   * other than 429 is a real error — retrying a bad request just wastes the
   * rate budget that is already scarce.
   */
  private async getJson(url: string): Promise<Result<unknown>> {
    let lastError = `request failed for ${url}`;
    for (let attempt = 0; attempt <= RETRY_STATUSES_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
      const result = await this.getJsonOnce(url);
      if (result.ok) return result;
      lastError = result.error;
      if (!isTransient(result.error)) return result;
    }
    return err(`${lastError} (after ${RETRY_STATUSES_MAX_ATTEMPTS} retries)`);
  }

  private async getJsonOnce(url: string): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return err(`HTTP ${response.status} from ${url}`);
      return ok((await response.json()) as unknown);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err(`request failed for ${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Retries after ~0.5s, 1s, 2s — enough for a rate-limit burst to clear. */
const RETRY_STATUSES_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Rate-limit and server-busy responses are worth retrying; a 404 is not. */
function isTransient(error: string): boolean {
  return /HTTP (429|5\d\d) /.test(error);
}

// --- Ticker payload helpers -------------------------------------------------
// Kraken encodes every number as a string, and several fields arrive as
// [today, last24h] pairs. These normalise that without ever yielding NaN.

/** Finite number from a Kraken string field, or null when unusable. */
function num(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** First element of a Kraken tuple (e.g. `c` = [last, lotVolume]). */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** The rolling-24h element of a [today, last24h] tuple. */
function last24h(value: unknown): unknown {
  return Array.isArray(value) ? value[1] ?? value[0] : value;
}
