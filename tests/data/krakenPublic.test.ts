/**
 * Kraken public data source tests (TDD).
 *
 * Browser-direct, keyless, CORS-open market data so the platform works on
 * a phone with no local proxy. Read-only by construction, like every data
 * source in this platform.
 */

import { describe, expect, it } from 'vitest';
import { CANDIDATE_INSTRUMENTS, CURATED_INSTRUMENTS, KrakenPublicSource } from '../../src/core/data/krakenPublic';

const NOW = 1_700_000_000_000;
// Mirrors the curated-majors order in src/core/data/krakenPublic.ts — the
// agent trades exactly these 20, in this order (`slice(0, 20)`).
const CURATED_SYMBOLS = [
  'XBTEUR', 'ETHEUR', 'SOLEUR', 'XRPEUR', 'ADAEUR',
  'DOGEEUR', 'LTCEUR', 'DOTEUR', 'LINKEUR', 'AVAXEUR',
  'UNIEUR', 'FILEUR', 'AAVEEUR', 'ATOMEUR', 'XLMEUR', 'ALGOEUR',
  'HNTEUR', 'VELOEUR', 'AEROEUR', 'ENAEUR',
];

/** Kraken OHLC row: [timeSec, open, high, low, close, vwap, volume, count]. */
function krakenRow(timeSec: number, close: number, volume: number) {
  const open = close - 0.5;
  return [
    timeSec,
    String(open),
    String(close + 1), // high
    String(open - 1), // low
    String(close),
    String(close - 0.2), // vwap — must be dropped by the remapping
    String(volume),
    42,
  ];
}

function mockFetch(body: unknown, seenUrls: string[] = []): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('instruments', () => {
  it('leads with the curated majors, in fixed order, even when the live pair list succeeds', async () => {
    const source = new KrakenPublicSource({
      fetchFn: mockFetch({
        error: [],
        result: {
          XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', status: 'online' },
          FOOEUR: { altname: 'FOOEUR', wsname: 'FOO/EUR', status: 'online' },
          BAREUR: { altname: 'BARUSD', wsname: 'BAR/USD', status: 'online' }, // wrong quote — excluded
          BAZEUR: { altname: 'BAZEUR', wsname: 'BAZ/EUR', status: 'cancel_only' }, // delisted — excluded
        },
      }),
    });
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(8);
    const bitcoin = result.value.find((i) => i.symbol === 'XBTEUR')!;
    expect(bitcoin.base).toBe('BTC'); // display name, not Kraken's XBT
    expect(bitcoin.quote).toBe('EUR');
    expect(result.value.slice(0, 20).map((i) => i.symbol)).toEqual(CURATED_SYMBOLS);
    // Broadened beyond the curated 20 with the newly-discovered EUR pair.
    expect(result.value.some((i) => i.symbol === 'FOOEUR')).toBe(true);
    // Wrong-quote and delisted pairs never make it in.
    expect(result.value.some((i) => i.symbol === 'BARUSD')).toBe(false);
    expect(result.value.some((i) => i.symbol === 'BAZEUR')).toBe(false);
  });

  it('falls back to the static display list (still curated-majors-first) if the live pair list fails', async () => {
    const source = new KrakenPublicSource({
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slice(0, 20).map((i) => i.symbol)).toEqual(CURATED_SYMBOLS);
    expect(result.value.length).toBeGreaterThan(24); // curated 20 + the static fallback extras
  });

  it('caches the merged instrument list — one network round trip, not one per call', async () => {
    let calls = 0;
    const source = new KrakenPublicSource({
      fetchFn: (async () => {
        calls++;
        return new Response(JSON.stringify({ error: [], result: {} }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await source.getInstruments();
    await source.getInstruments();
    expect(calls).toBe(1);
  });

  it('is read-only by construction (no order-placing/trade-executing methods)', () => {
    // Bare "order"/"trade" would also flag legitimate read-only lookups like
    // getOrderBook/getRecentTrades (public market-structure data, same
    // category as getCandles/getTickers) — the actual guard is against verbs
    // that would place, execute, or move money.
    const source = new KrakenPublicSource({ fetchFn: mockFetch({}) });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(source));
    for (const name of methods) {
      expect(name).not.toMatch(/buy|sell|withdraw|transfer|place|submit|cancel|execute/i);
    }
  });
});

describe('getCandles', () => {
  it('requests the right interval and parses rows, remapping vwap out', async () => {
    const urls: string[] = [];
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch(
        {
          error: [],
          result: {
            XXBTZEUR: [krakenRow(1_700_000_000, 105, 7.5), krakenRow(1_699_996_400, 102, 3.25)],
            last: 1_700_000_000,
          },
        },
        urls,
      ),
    });
    const result = await source.getCandles('XBTEUR', '4h', 10);
    expect(urls[0]).toContain('pair=XBTEUR');
    expect(urls[0]).toContain('interval=240'); // 4h in minutes
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sorted ascending by the shared parser; volume from index 6, not vwap.
    expect(result.value[0]!.close).toBe(102);
    expect(result.value[0]!.volume).toBe(3.25);
    expect(result.value[1]!.volume).toBe(7.5);
    expect(result.value[0]!.timestamp).toBe(1_699_996_400_000); // seconds -> ms
  });

  it('resolves the result key even when it differs from the requested pair', async () => {
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({
        error: [],
        result: { WEIRDKEY: [krakenRow(1_700_000_000, 50, 1)], last: 1 },
      }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.close).toBe(50);
  });

  it('keeps only the most recent `limit` candles', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => krakenRow(1_700_000_000 + i * 3600, 100 + i, 1));
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({ error: [], result: { XXBTZEUR: rows, last: 1 } }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(5);
    expect(result.value[4]!.close).toBe(119); // the newest survived
  });

  it('surfaces Kraken error payloads as errors', async () => {
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({ error: ['EGeneral:Too many requests'], result: {} }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Too many requests');
  });

  it('returns errors for HTTP/network failures instead of throwing', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const source = new KrakenPublicSource({ fetchFn: failing, now: () => NOW });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('offline');
  });

  it('serialises concurrent requests through the rate-limit queue', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const source = new KrakenPublicSource({
      now: () => NOW,
      staggerMs: 1,
      fetchFn: (async (url: RequestInfo | URL) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        order.push(String(url));
        return new Response(
          JSON.stringify({ error: [], result: { K: [krakenRow(1_700_000_000, 1, 1)], last: 1 } }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await Promise.all([
      source.getCandles('XBTEUR', '1h', 5),
      source.getCandles('ETHEUR', '1h', 5),
      source.getCandles('SOLEUR', '1h', 5),
    ]);
    expect(order).toHaveLength(3);
    expect(maxInFlight).toBe(1); // never parallel — Kraken rate limits respected
  });

  it('a priority request jumps ahead of already-queued background work', async () => {
    // This is the fix for the chart freezing behind the Markets list sweep:
    // a coin the user just opened must not wait behind a whole background
    // scan, only behind whatever single request is already in flight.
    const order: string[] = [];
    let maxInFlight = 0;
    let inFlight = 0;
    const source = new KrakenPublicSource({
      now: () => NOW,
      staggerMs: 1,
      fetchFn: (async (url: RequestInfo | URL) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        const pair = new URL(String(url)).searchParams.get('pair')!;
        order.push(pair);
        return new Response(
          JSON.stringify({ error: [], result: { K: [krakenRow(1_700_000_000, 1, 1)], last: 1 } }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    // Fire a background "list sweep" of several coins (no priority)...
    const background = ['AAAEUR', 'BBBEUR', 'CCCEUR', 'DDDEUR'].map((p) =>
      source.getCandles(p, '1h', 5),
    );
    // ...then, right after, the user opens BTC — a priority request.
    const priority = source.getCandles('XBTEUR', '1h', 5, { priority: true });

    await Promise.all([...background, priority]);

    // Still never parallel — same safety invariant as always.
    expect(maxInFlight).toBe(1);
    // The very first background request was already in flight and finishes
    // first, but the priority request jumps ahead of the REST of the
    // background queue rather than running last.
    expect(order[0]).toBe('AAAEUR');
    expect(order[1]).toBe('XBTEUR');
  });
});

describe('getOrderBook', () => {
  it('parses bids and asks, closest-to-mid first', async () => {
    const urls: string[] = [];
    const source = new KrakenPublicSource({
      fetchFn: mockFetch(
        {
          error: [],
          result: {
            XXBTZEUR: {
              asks: [['56200.1', '0.5', 1_700_000_000], ['56210.0', '1.2', 1_700_000_000]],
              bids: [['56190.0', '0.8', 1_700_000_000], ['56180.0', '2.0', 1_700_000_000]],
            },
          },
        },
        urls,
      ),
    });
    const result = await source.getOrderBook('XBTEUR', 10);
    expect(urls[0]).toContain('Depth?pair=XBTEUR');
    expect(urls[0]).toContain('count=10');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.asks[0]).toEqual({ price: 56200.1, volume: 0.5 });
    expect(result.value.bids[0]).toEqual({ price: 56190, volume: 0.8 });
  });

  it('drops zero/negative levels rather than showing a fake price', async () => {
    const source = new KrakenPublicSource({
      fetchFn: mockFetch({
        error: [],
        result: { XXBTZEUR: { asks: [['0', '1', 1]], bids: [['100', '0', 1]] } },
      }),
    });
    const result = await source.getOrderBook('XBTEUR');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.asks).toHaveLength(0);
      expect(result.value.bids).toHaveLength(0);
    }
  });

  it('surfaces Kraken error payloads as errors', async () => {
    const source = new KrakenPublicSource({
      fetchFn: mockFetch({ error: ['EGeneral:Too many requests'], result: {} }),
    });
    const result = await source.getOrderBook('XBTEUR');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Too many requests');
  });
});

describe('getRecentTrades', () => {
  it('parses trades, newest first, mapping side and seconds to ms', async () => {
    const urls: string[] = [];
    const source = new KrakenPublicSource({
      fetchFn: mockFetch(
        {
          error: [],
          result: {
            XXBTZEUR: [
              ['56100.0', '0.1', 1_700_000_000, 'b', 'm', '', 1],
              ['56105.0', '0.2', 1_700_000_060, 's', 'm', '', 2],
            ],
            last: '1700000060000000000',
          },
        },
        urls,
      ),
    });
    const result = await source.getRecentTrades('XBTEUR', 20);
    expect(urls[0]).toContain('Trades?pair=XBTEUR');
    expect(urls[0]).toContain('count=20');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({ price: 56105, volume: 0.2, time: 1_700_000_060_000, side: 'sell' });
    expect(result.value[1]!.side).toBe('buy');
  });

  it('surfaces Kraken error payloads as errors', async () => {
    const source = new KrakenPublicSource({
      fetchFn: mockFetch({ error: ['EGeneral:Too many requests'], result: {} }),
    });
    const result = await source.getRecentTrades('XBTEUR');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Too many requests');
  });
});

describe('batch tickers', () => {
  /** Routes AssetPairs and Ticker to different bodies, like the real API. */
  function routedFetch(
    assetPairs: unknown,
    ticker: unknown,
    seenUrls: string[] = [],
  ): typeof fetch {
    return (async (url: RequestInfo | URL) => {
      const href = String(url);
      seenUrls.push(href);
      const body = href.includes('/Ticker') ? ticker : assetPairs;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  }

  const ASSET_PAIRS = {
    error: [],
    result: {
      XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', status: 'online' },
      FOOEUR: { altname: 'FOOEUR', wsname: 'FOO/EUR', status: 'online' },
      BARUSD: { altname: 'BARUSD', wsname: 'BAR/USD', status: 'online' },
    },
  };

  /** Kraken ticker entry: c=[last,lot] o=open h/l/v/p=[today,last24h] */
  const tickerEntry = (last: string, open: string, vol: string, vwap: string) => ({
    a: [last, '1', '1.0'],
    b: [last, '1', '1.0'],
    c: [last, '0.5'],
    v: ['1.0', vol],
    p: [vwap, vwap],
    t: [10, 20],
    l: ['1', '1'],
    h: ['9', '9'],
    o: open,
  });

  it('returns every EUR market from a single request, keyed by altname', async () => {
    const seen: string[] = [];
    const source = new KrakenPublicSource({
      fetchFn: routedFetch(
        ASSET_PAIRS,
        {
          error: [],
          result: {
            XXBTZEUR: tickerEntry('100', '80', '3', '90'),
            FOOEUR: tickerEntry('5', '5', '10', '5'),
            BARUSD: tickerEntry('7', '7', '1', '7'), // not EUR — must be dropped
          },
        },
        seen,
      ),
    });

    const result = await source.getTickers!();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Kraken's internal key (XXBTZEUR) is translated to our altname (XBTEUR).
    const btc = result.value.find((t) => t.symbol === 'XBTEUR');
    expect(btc).toBeDefined();
    expect(btc!.price).toBe(100);
    expect(btc!.open).toBe(80);
    expect(btc!.volume).toBe(3); // the 24h element, not today's
    expect(btc!.quoteVolume).toBe(270); // volume x vwap

    // Non-EUR pairs never appear, even though Ticker returns them.
    expect(result.value.some((t) => t.symbol === 'BARUSD')).toBe(false);

    // Exactly ONE Ticker request covers every market — the whole point.
    expect(seen.filter((u) => u.includes('/Ticker'))).toHaveLength(1);
  });

  it('reports a Kraken API error instead of returning half a market list', async () => {
    const source = new KrakenPublicSource({
      fetchFn: routedFetch(ASSET_PAIRS, { error: ['EGeneral:Temporary lockout'], result: {} }),
    });
    const result = await source.getTickers!();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Temporary lockout');
  });

  it('skips malformed entries rather than emitting NaN prices', async () => {
    const source = new KrakenPublicSource({
      fetchFn: routedFetch(ASSET_PAIRS, {
        error: [],
        result: {
          XXBTZEUR: tickerEntry('100', '80', '3', '90'),
          FOOEUR: { c: ['not-a-number', '1'], o: '5', v: ['1', '2'], p: ['5', '5'] },
        },
      }),
    });
    const result = await source.getTickers!();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.symbol).toBe('XBTEUR');
    expect(result.value.every((t) => Number.isFinite(t.price))).toBe(true);
  });
});

describe('Kraken asset aliases', () => {
  /**
   * Kraken lists Dogecoin as XDG, not DOGE — exactly like XBT for Bitcoin.
   * Without normalising it, the curated DOGEEUR entry and the discovered
   * XDGEUR entry are treated as two different assets and Dogecoin appears
   * TWICE in the browsable universe: once as "Dogecoin", once as "XDG".
   */
  const ASSET_PAIRS_WITH_XDG = {
    error: [],
    result: {
      XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', status: 'online' },
      XDGEUR: { altname: 'XDGEUR', wsname: 'XDG/EUR', status: 'online' },
      NEWEUR: { altname: 'NEWEUR', wsname: 'NEW/EUR', status: 'online' },
    },
  };

  function routed(assetPairs: unknown, ticker: unknown): typeof fetch {
    return (async (url: RequestInfo | URL) =>
      new Response(JSON.stringify(String(url).includes('/Ticker') ? ticker : assetPairs), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
  }

  it('lists Dogecoin exactly once, under its curated symbol', async () => {
    const source = new KrakenPublicSource({
      fetchFn: routed(ASSET_PAIRS_WITH_XDG, { error: [], result: {} }),
    });
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dogecoins = result.value.filter((i) => i.base === 'DOGE' || i.base === 'XDG');
    expect(dogecoins).toHaveLength(1);
    expect(dogecoins[0]!.base).toBe('DOGE');
    // The curated symbol is preserved — the agent's trading path is untouched.
    expect(dogecoins[0]!.symbol).toBe('DOGEEUR');
    expect(result.value.some((i) => i.symbol === 'XDGEUR')).toBe(false);
    // Unrelated new pairs still broaden the universe as before.
    expect(result.value.some((i) => i.symbol === 'NEWEUR')).toBe(true);
  });

  it("maps Dogecoin's ticker onto the curated symbol, so it is not lost from the list", async () => {
    const entry = (last: string, open: string) => ({
      c: [last, '1'], o: open, v: ['1', '2'], p: ['1', '1'], h: ['1', '1'], l: ['1', '1'],
    });
    const source = new KrakenPublicSource({
      fetchFn: routed(ASSET_PAIRS_WITH_XDG, {
        error: [],
        result: { XDGEUR: entry('0.20', '0.25'), XXBTZEUR: entry('100', '90') },
      }),
    });
    const result = await source.getTickers!();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doge = result.value.find((t) => t.symbol === 'DOGEEUR');
    expect(doge).toBeDefined();
    expect(doge!.price).toBe(0.2);
    expect(result.value.some((t) => t.symbol === 'XDGEUR')).toBe(false);
  });
});

describe('transient failure handling', () => {
  /** Responds with `statuses` in order, then a valid payload. */
  function flakyFetch(statuses: number[], seen: { attempts: number }): typeof fetch {
    return (async () => {
      const status = statuses[seen.attempts];
      seen.attempts++;
      if (status !== undefined) {
        return new Response('busy', { status });
      }
      return new Response(
        JSON.stringify({ error: [], result: { XXBTZEUR: { altname: 'XBTEUR', wsname: 'XBT/EUR', status: 'online' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
  }

  it('retries a 503 and succeeds — a busy exchange must not silently drop a symbol', async () => {
    const seen = { attempts: 0 };
    const source = new KrakenPublicSource({ fetchFn: flakyFetch([503, 503], seen), staggerMs: 0 });
    const result = await source.getInstruments();

    expect(result.ok).toBe(true);
    expect(seen.attempts).toBe(3); // two failures, then the success
    if (!result.ok) return;
    expect(result.value.some((i) => i.symbol === 'XBTEUR')).toBe(true);
  });

  it('retries a 429 rate limit', async () => {
    const seen = { attempts: 0 };
    const source = new KrakenPublicSource({ fetchFn: flakyFetch([429], seen), staggerMs: 0 });
    expect((await source.getInstruments()).ok).toBe(true);
    expect(seen.attempts).toBe(2);
  });

  it('does NOT retry a 404 — that wastes a scarce rate budget on a real error', async () => {
    const seen = { attempts: 0 };
    const source = new KrakenPublicSource({ fetchFn: flakyFetch([404, 404, 404, 404], seen), staggerMs: 0 });
    // Falls back to the static display list rather than hanging on retries.
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    expect(seen.attempts).toBe(1); // one attempt only
  });

  it('gives up after a bounded number of retries rather than looping forever', async () => {
    const seen = { attempts: 0 };
    const source = new KrakenPublicSource({
      fetchFn: flakyFetch([503, 503, 503, 503, 503, 503], seen),
      staggerMs: 0,
    });
    const result = await source.getCandles('XBTEUR', '1h', 10);
    expect(result.ok).toBe(false);
    expect(seen.attempts).toBe(4); // initial + 3 retries
    if (result.ok) return;
    expect(result.error).toContain('retries');
  });
});

describe('CANDIDATE_INSTRUMENTS (forward-test-only, never real trading)', () => {
  it('lists exactly the 13 measured candidates, each a valid EUR pair', () => {
    expect(CANDIDATE_INSTRUMENTS).toHaveLength(13);
    for (const i of CANDIDATE_INSTRUMENTS) {
      expect(i.quote).toBe('EUR');
      expect(i.symbol).toBe(`${i.base}EUR`); // no Kraken alias needed for any of these
    }
    expect(CANDIDATE_INSTRUMENTS.map((i) => i.base)).toEqual([
      'PUMP', 'XMR', 'SPX', 'CRV', 'DASH', 'ZRO', 'BONK', 'OP', 'SYRUP', 'MINA', 'TIA', 'CHIP', 'PENDLE',
    ]);
  });

  it('never overlaps the curated real-trading universe', () => {
    const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));
    expect(CANDIDATE_INSTRUMENTS.every((i) => !curatedSymbols.has(i.symbol))).toBe(true);
  });
});
