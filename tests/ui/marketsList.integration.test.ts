// @vitest-environment happy-dom
/**
 * Markets LIST integration (real DOM via happy-dom).
 *
 * The list is now built from a single batch-ticker request covering every EUR
 * market, and renders a page of rows at a time rather than all several hundred
 * up front. These cover the row contents the redesign promises (absolute change
 * beside the percent, an update stamp, no per-row sparkline), the paging, and
 * that a tap still opens the detail view through the delegated handler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { renderMarketsView } from '../../src/ui/views/marketsView';
import type { Candle, Instrument, Ticker } from '../../src/core/types';
import { ok } from '../../src/core/types';

const ANCHOR = 1_700_000_000_000;
/** Enough markets to prove paging: more than one page of 50. */
const COUNT = 120;

const INSTRUMENTS: Instrument[] = Array.from({ length: COUNT }, (_, i) => ({
  symbol: i === 0 ? 'XBTEUR' : `C${i}EUR`,
  base: i === 0 ? 'BTC' : `C${i}`,
  quote: 'EUR',
}));

function candles(): Candle[] {
  return Array.from({ length: 100 }, (_, i) => ({
    timestamp: ANCHOR - (100 - i) * 3_600_000,
    open: 100, high: 101, low: 99, close: 100 + i * 0.1, volume: 5,
  }));
}

function makeData(): ActiveDataSource {
  const source: MarketDataSource = {
    name: 'test',
    getInstruments: async () => ok(INSTRUMENTS),
    getCandles: async () => ok(candles()),
    getTickers: async () =>
      ok(
        INSTRUMENTS.map((inst, i): Ticker => ({
          symbol: inst.symbol,
          price: i === 0 ? 64161.15 : 10 + i,
          open: i === 0 ? 65404.85 : 10, // BTC down, the rest up
          high: 0, low: 0, volume: 1,
          quoteVolume: (COUNT - i) * 1000, // descending liquidity
        })),
      ),
  };
  return { source, instruments: INSTRUMENTS, isLive: true, kind: 'kraken' as ActiveDataSource['kind'], diagnostics: [] };
}

async function waitFor(condition: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => vi.unstubAllGlobals());

describe('Markets list (DOM integration)', () => {
  it('shows the absolute change beside the percent, and an update stamp', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    const btc = container.querySelector('.market-row')!;
    expect(btc.querySelector('.row-title')!.textContent).toBe('Bitcoin');
    expect(btc.querySelector('.row-price')!.textContent).toBe('€64,161.15');

    // Absolute change AND percent, both signed — the reference layout.
    const chg = btc.querySelector('.chg')!.textContent!;
    expect(chg).toContain('-1,243.70');
    expect(chg).toContain('(-1.90%)');
    expect(btc.querySelector('.chg')!.className).toContain('down');

    // Freshness stamp with its indicator dot.
    expect(btc.querySelector('.row-clock')).not.toBeNull();
    expect(btc.querySelector('.row-sub')!.textContent).toContain('XBTEUR');
    handle.pause();
  });

  it('carries no per-row sparkline — that is what capped the old list', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    expect(container.querySelector('.market-row-spark')).toBeNull();
    expect(container.querySelector('.market-row svg')).toBeNull();
    handle.pause();
  });

  /** Switch to the All tab, which is the only category that pages. */
  function showAll(container: HTMLElement): void {
    container.querySelector<HTMLElement>('[data-cat="all"]')!.click();
  }

  it('renders one page of rows up front, not all several hundred', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    showAll(container);

    const rendered = container.querySelectorAll('.market-row').length;
    expect(rendered).toBe(50);
    expect(rendered).toBeLessThan(COUNT);
    // And it says how much more there is, rather than looking truncated.
    expect(container.querySelector('#mk-more')!.textContent).toContain(`of ${COUNT}`);
    handle.pause();
  });

  it('opens the detail view when a row is tapped, via the delegated handler', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => !container.querySelector<HTMLElement>('#mk-detail-view')!.hidden);

    expect(container.querySelector<HTMLElement>('#mk-detail-view')!.hidden).toBe(false);
    await waitFor(() => container.querySelector('.detail-name') !== null);
    expect(container.querySelector('.detail-name')!.textContent).toBe('Bitcoin');
    handle.pause();
  });

  it('orders the curated majors first, ahead of more liquid long-tail markets', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    // C1EUR has the higher quote volume, but BTC is a curated major.
    const titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles[0]).toBe('Bitcoin');
    handle.pause();
  });

  it('pause() disconnects the paging observer so a hidden view does no work', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    showAll(container); // All is the category that actually pages

    disconnect.mockClear();
    handle.pause();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('Markets categories and logos', () => {
  function showAll(container: HTMLElement): void {
    container.querySelector<HTMLElement>('[data-cat="all"]')!.click();
  }

  it('switches category without refetching — every tab is a view of one response', async () => {
    let tickerCalls = 0;
    const data = makeData();
    const original = data.source.getTickers!.bind(data.source);
    (data.source as { getTickers: () => unknown }).getTickers = () => {
      tickerCalls++;
      return original();
    };

    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, data);
    await waitFor(() => container.querySelector('.market-row') !== null);

    const afterLoad = tickerCalls;
    showAll(container);
    container.querySelector<HTMLElement>('[data-cat="gainers"]')!.click();
    container.querySelector<HTMLElement>('[data-cat="volume"]')!.click();

    expect(tickerCalls).toBe(afterLoad); // no extra network for a tab switch
    expect(container.querySelector('.mk-tab.active')!.textContent).toBe('Volume');
    handle.pause();
  });

  it('shows only rising markets under Gainers, ranked hardest first', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-cat="gainers"]')!.click();
    const changes = [...container.querySelectorAll('.market-row .chg')].map((e) => e.textContent!);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.startsWith('+'))).toBe(true);
    // BTC is the only faller in the fixture, so it must be absent.
    const titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).not.toContain('Bitcoin');
    handle.pause();
  });

  it('resets to the top of the list when the category changes', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    showAll(container);
    expect(container.querySelectorAll('.market-row').length).toBe(50);
    container.querySelector<HTMLElement>('[data-cat="volume"]')!.click();
    // A fresh category starts at one page again, not wherever the last had scrolled.
    expect(container.querySelectorAll('.market-row').length).toBe(50);
    handle.pause();
  });

  it('gives every row a logo — a real mark where one exists, a letter tile otherwise', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    const rows = [...container.querySelectorAll('.market-row')];
    expect(rows.every((r) => r.querySelector('.coin-logo') !== null)).toBe(true);

    // BTC ships a real SVG; the synthetic C1..C119 codes cannot, so they tile.
    expect(rows[0]!.querySelector('img.coin-logo')).not.toBeNull();
    expect(rows[1]!.querySelector('.coin-logo-tile')).not.toBeNull();
    handle.pause();
  });

  it('requests no image for an asset with no bundled mark', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    showAll(container);

    // Emitting <img> for all 535 assets would fire hundreds of 404s per render.
    const images = container.querySelectorAll('img.coin-logo').length;
    const tiles = container.querySelectorAll('.coin-logo-tile').length;
    expect(images).toBe(1); // BTC only
    expect(images + tiles).toBe(container.querySelectorAll('.market-row').length);
    handle.pause();
  });
});

describe('Markets categories without volume data', () => {
  /**
   * Only Kraken exposes a batch ticker. On the demo source — which is exactly
   * what the deployed app falls back to when Kraken is unreachable — rows come
   * from the per-symbol sweep and carry no volume at all. The mover tabs must
   * still work rather than showing an empty screen.
   */
  function makeNoVolumeData(): ActiveDataSource {
    const source: MarketDataSource = {
      name: 'no-batch-ticker',
      getInstruments: async () => ok(INSTRUMENTS.slice(0, 6)),
      getCandles: async (symbol) => {
        // First instrument falls, the rest rise, so both mover tabs have input.
        const rising = symbol !== 'XBTEUR';
        return ok(
          Array.from({ length: 50 }, (_, i) => {
            const close = rising ? 100 + i : 100 - i;
            return { timestamp: ANCHOR - (50 - i) * 3_600_000, open: close, high: close, low: close, close, volume: 5 };
          }) as Candle[],
        );
      },
      // deliberately no getTickers
    };
    return { source, instruments: INSTRUMENTS.slice(0, 6), isLive: true, kind: 'demo' as ActiveDataSource['kind'], diagnostics: [] };
  }

  it('still fills Gainers when the source reports no volume', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeNoVolumeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-cat="gainers"]')!.click();
    const rows = container.querySelectorAll('.market-row').length;
    expect(rows).toBeGreaterThan(0);
    expect(container.querySelector('.empty')).toBeNull();
    handle.pause();
  });

  it('still fills Losers when the source reports no volume', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeNoVolumeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-cat="losers"]')!.click();
    expect(container.querySelectorAll('.market-row').length).toBeGreaterThan(0);
    handle.pause();
  });

  it('keeps the volume floor when volume IS reported, so microcaps stay out', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    // The standard fixture has descending volume; the thinnest rows are far
    // below the floor and must not appear among the movers.
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-cat="gainers"]')!.click();
    const shown = container.querySelectorAll('.market-row').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(COUNT - 1); // the sub-floor tail is excluded
    handle.pause();
  });
});

describe('Markets search, sort and watchlist', () => {
  /** The search input is debounced; give it time to settle. */
  async function type(container: HTMLElement, text: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('#mk-search')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
  }

  beforeEach(() => window.localStorage.clear());

  it('filters the list as you type, matching name or symbol', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    await type(container, 'bitcoin');
    let titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Bitcoin']);

    await type(container, 'xbteur');
    titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Bitcoin']);
    handle.pause();
  });

  it('says "market" (singular), not "markets", when exactly one is shown', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    await type(container, 'bitcoin');
    expect(container.querySelector('.market-more')!.textContent).toBe('All 1 market shown');
    handle.pause();
  });

  it('says so when nothing matches, rather than showing a blank list', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    await type(container, 'zzzznope');
    expect(container.querySelectorAll('.market-row')).toHaveLength(0);
    expect(container.querySelector('.empty')!.textContent).toContain('zzzznope');
    handle.pause();
  });

  it('searches the whole universe, not just the rows already rendered', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    // C119 is the last of 120 markets — far past the first rendered page, and
    // outside the 40-row Popular tab entirely.
    await type(container, 'C119');
    const titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).toContain('C119');
    handle.pause();
  });

  it('reorders on sort without refetching', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    const select = container.querySelector<HTMLSelectElement>('#mk-sort')!;
    select.value = 'name';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent!);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    handle.pause();
  });

  it('stars a market and collects it under the Watchlist tab', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.click();
    container.querySelector<HTMLElement>('[data-cat="watchlist"]')!.click();

    const titles = [...container.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Bitcoin']);
    expect(container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.className).toContain('on');
    handle.pause();
  });

  it('bounces the star icon when it is newly favourited, not when un-starred', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.click();
    // `renderList()` rebuilds the row, so the class lands on the FRESH button.
    expect(container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.className).toContain('pop');

    container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.click();
    expect(container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.className).not.toContain('pop');
    handle.pause();
  });

  it('starring does not also open the coin detail', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(container.querySelector<HTMLElement>('#mk-detail-view')!.hidden).toBe(true);
    handle.pause();
  });

  it('explains the empty watchlist instead of looking broken', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLElement>('[data-cat="watchlist"]')!.click();
    expect(container.querySelector('.empty')!.textContent).toContain('No starred markets yet');
    handle.pause();
  });

  it('keeps the watchlist across a remount', async () => {
    const first = document.createElement('section');
    document.body.appendChild(first);
    const h1 = renderMarketsView(first, makeData());
    await waitFor(() => first.querySelector('.market-row') !== null);
    first.querySelector<HTMLElement>('[data-star="XBTEUR"]')!.click();
    h1.pause();

    const second = document.createElement('section');
    document.body.appendChild(second);
    const h2 = renderMarketsView(second, makeData());
    await waitFor(() => second.querySelector('.market-row') !== null);
    second.querySelector<HTMLElement>('[data-cat="watchlist"]')!.click();

    const titles = [...second.querySelectorAll('.market-row .row-title')].map((e) => e.textContent);
    expect(titles).toEqual(['Bitcoin']);
    h2.pause();
  });
});

describe('Markets loading and tick feedback', () => {
  it('shows skeleton placeholders before data lands, and they are not real rows', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());

    // Synchronously after mount, before the fetch resolves.
    expect(container.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    // A placeholder must never be picked up by code selecting real rows.
    expect(container.querySelector('.market-row')).toBeNull();
    handle.pause();
  });

  it('replaces the skeletons once data arrives', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(0);
    handle.pause();
  });

  it('flashes only the prices that actually moved on a refresh', async () => {
    let tick = 0;
    const data = makeData();
    const original = data.source.getTickers!.bind(data.source);
    (data.source as { getTickers: () => unknown }).getTickers = async () => {
      const result = (await original()) as { ok: true; value: Ticker[] };
      tick++;
      // On the second load, move BTC up and leave everything else alone.
      return tick < 2 ? result : {
        ok: true,
        value: result.value.map((t, i) => (i === 0 ? { ...t, price: t.price + 100 } : t)),
      };
    };

    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, data);
    await waitFor(() => container.querySelector('.market-row') !== null);

    // First render establishes a baseline — nothing has "moved" yet.
    expect(container.querySelectorAll('.flash-up, .flash-down')).toHaveLength(0);

    // Force a second load; BTC's price is now higher, nothing else changed.
    handle.pause();
    handle.resume();
    await waitFor(() => container.querySelector('.flash-up') !== null);

    const flashed = container.querySelectorAll('.flash-up, .flash-down');
    expect(flashed).toHaveLength(1); // exactly the one that moved, not the whole list
    const btcRow = container.querySelector('.market-row')!;
    expect(btcRow.querySelector('.row-price')!.className).toContain('flash-up');
    handle.pause();
  });

  it('says so when the very first load finds nothing, instead of showing skeletons forever', async () => {
    const data = makeData();
    (data.source as { getTickers: () => unknown }).getTickers = async () => ({ ok: false, error: 'down' });
    data.source.getCandles = async () => ok([] as Candle[]);

    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, data);
    await waitFor(() => container.querySelector('.empty') !== null);

    expect(container.querySelector('.empty')!.textContent).toContain('unavailable');
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(0);
    handle.pause();
  });
});
