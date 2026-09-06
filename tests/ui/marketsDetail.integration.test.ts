// @vitest-environment happy-dom
/**
 * Coin-detail non-chart view modes (Order book / Depth / Trades / Trade) —
 * real DOM via happy-dom. The chart mode itself is covered by the range/mode
 * tests elsewhere; these cover the four modes that got a real design pass
 * (depth bars + spread, best-bid/mid/best-ask, a labelled trades tape, and a
 * Buy/Sell toggle that now actually toggles) rather than a bare fetch-and-
 * dump of the raw API shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { OrderBook, RecentTrade } from '../../src/core/data/krakenPublic';
import { renderMarketsView } from '../../src/ui/views/marketsView';
import type { Candle, Instrument, Ticker } from '../../src/core/types';
import { ok } from '../../src/core/types';

const ANCHOR = 1_700_000_000_000;
const INSTRUMENTS: Instrument[] = [
  { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' },
  { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' },
];

function candles(): Candle[] {
  return Array.from({ length: 50 }, (_, i) => ({
    timestamp: ANCHOR - (50 - i) * 3_600_000,
    open: 100, high: 101, low: 99, close: 100 + i * 0.1, volume: 5,
  }));
}

const BOOK: OrderBook = {
  bids: [
    { price: 100, volume: 2 },
    { price: 99, volume: 1 },
  ],
  asks: [
    { price: 101, volume: 1 },
    { price: 102, volume: 3 },
  ],
};
const TRADES: RecentTrade[] = [
  { price: 100.5, volume: 0.1, time: ANCHOR, side: 'buy' },
  { price: 100.2, volume: 0.2, time: ANCHOR - 1000, side: 'sell' },
];

function makeData(): ActiveDataSource {
  const source: MarketDataSource & {
    getOrderBook: (symbol: string, count?: number) => Promise<{ ok: true; value: OrderBook }>;
    getRecentTrades: (symbol: string, count?: number) => Promise<{ ok: true; value: RecentTrade[] }>;
  } = {
    name: 'test',
    getInstruments: async () => ok(INSTRUMENTS),
    getCandles: async () => ok(candles()),
    getTickers: async () =>
      ok(
        INSTRUMENTS.map((inst, i): Ticker => ({
          symbol: inst.symbol,
          price: i === 0 ? 100 : 10,
          open: i === 0 ? 95 : 10,
          high: 0, low: 0, volume: 1, quoteVolume: 1000,
        })),
      ),
    getOrderBook: async () => ({ ok: true, value: BOOK }),
    getRecentTrades: async () => ({ ok: true, value: TRADES }),
  };
  return { source, instruments: INSTRUMENTS, isLive: true, kind: 'kraken' as ActiveDataSource['kind'], diagnostics: [] };
}

async function waitFor(condition: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openDetailAndSwitchTo(container: HTMLElement, view: string): Promise<void> {
  (container.querySelector('.market-row') as HTMLElement).click();
  await waitFor(() => container.querySelector('.detail-name') !== null);
  (container.querySelector<HTMLElement>(`.view-tab[data-view="${view}"]`)!).click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => vi.unstubAllGlobals());

describe('Coin detail: Order book (table)', () => {
  it('renders a depth bar and the spread, not just the raw ladder', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    await openDetailAndSwitchTo(container, 'table');
    await waitFor(() => container.querySelector('.ob-bid') !== null);

    const bestBidRow = container.querySelector('.ob-bid')!;
    // The bar is a CSS custom property driving a background width, not
    // fabricated text, scaled against the larger side's cumulative total
    // (asks: 1+3=4 here) — the best bid's own cumulative (2) is half that.
    expect(bestBidRow.getAttribute('style')).toContain('--bar:50.0%');
    expect(container.querySelector('.orderbook-spread')!.textContent).toContain('Spread');
    expect(container.querySelector('.orderbook-spread')!.textContent).toContain('1.00%');
    handle.pause();
  });
});

describe('Coin detail: Depth chart', () => {
  it('labels best bid, mid and best ask alongside the step chart', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    await openDetailAndSwitchTo(container, 'depth');
    await waitFor(() => container.querySelector('svg.orderbook-depth') !== null);

    const stats = container.querySelector('.depth-stats')!;
    expect(stats.textContent).toContain('Best bid');
    expect(stats.textContent).toContain('€100.00');
    expect(stats.textContent).toContain('Mid');
    expect(stats.textContent).toContain('€100.50');
    expect(stats.textContent).toContain('Best ask');
    expect(stats.textContent).toContain('€101.00');
    handle.pause();
  });
});

describe('Coin detail: Trades tape', () => {
  it('labels its columns and tints each row by side', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    await openDetailAndSwitchTo(container, 'trades');
    await waitFor(() => container.querySelector('.trade-tape-row') !== null);

    expect(container.querySelector('.trade-tape-head')!.textContent).toBe('PriceAmountTime');
    const rows = container.querySelectorAll('.trade-tape-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).toContain('buy');
    expect(rows[1]!.className).toContain('sell');
    handle.pause();
  });
});

describe('Coin detail: Trade tab order form', () => {
  it('the Buy/Sell segmented control actually toggles, not just Buy forever', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    await openDetailAndSwitchTo(container, 'trade');
    await waitFor(() => container.querySelector('.of-btn.buy') !== null);

    const buyBtn = container.querySelector<HTMLButtonElement>('.of-btn.buy')!;
    const sellBtn = container.querySelector<HTMLButtonElement>('.of-btn.sell')!;
    expect(buyBtn.className).toContain('active');
    expect(container.querySelector('#mk-of-note')!.innerHTML).toContain('/buy XBTEUR');

    sellBtn.click();
    expect(sellBtn.className).toContain('active');
    expect(buyBtn.className).not.toContain('active');
    expect(container.querySelector('#mk-of-note')!.innerHTML).toContain('/sell XBTEUR');
    handle.pause();
  });
});

describe('Coin detail: pager names the neighbouring coin', () => {
  it('shows the next coin\'s symbol on the Next button, not just an arrow', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('#mk-next') !== null);

    expect(container.querySelector('#mk-next')!.textContent).toContain('ETH');
    expect(container.querySelector<HTMLButtonElement>('#mk-prev')!.disabled).toBe(true);
    handle.pause();
  });

  it('scrolls back to the top when switching coins, so the new header is not left off-screen', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('#mk-next') !== null);

    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    (container.querySelector<HTMLButtonElement>('#mk-next')!).click();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    handle.pause();
  });
});

describe('Coin detail: view-mode tabs are a real ARIA tablist', () => {
  it('carries role=tablist/tab and aria-selected, matching the category strip\'s own pattern', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('.view-tab') !== null);

    expect(container.querySelector('#mk-view-tabs')!.getAttribute('role')).toBe('tablist');
    const chartTab = container.querySelector<HTMLElement>('.view-tab[data-view="chart"]')!;
    const tableTab = container.querySelector<HTMLElement>('.view-tab[data-view="table"]')!;
    expect(chartTab.getAttribute('role')).toBe('tab');
    expect(chartTab.getAttribute('aria-selected')).toBe('true');
    expect(tableTab.getAttribute('aria-selected')).toBe('false');

    tableTab.click();
    await waitFor(() => container.querySelector('.view-tab[data-view="table"]')!.getAttribute('aria-selected') === 'true');
    expect(container.querySelector('.view-tab[data-view="chart"]')!.getAttribute('aria-selected')).toBe('false');
    handle.pause();
  });
});

describe('Coin detail: Trade tab Buy/Sell exposes its state to assistive tech', () => {
  it('sets aria-pressed on both sides, flipped by the toggle', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    await openDetailAndSwitchTo(container, 'trade');
    await waitFor(() => container.querySelector('.of-btn.buy') !== null);

    const buyBtn = container.querySelector<HTMLButtonElement>('.of-btn.buy')!;
    const sellBtn = container.querySelector<HTMLButtonElement>('.of-btn.sell')!;
    expect(buyBtn.getAttribute('aria-pressed')).toBe('true');
    expect(sellBtn.getAttribute('aria-pressed')).toBe('false');

    sellBtn.click();
    expect(buyBtn.getAttribute('aria-pressed')).toBe('false');
    expect(sellBtn.getAttribute('aria-pressed')).toBe('true');
    handle.pause();
  });
});

describe('Coin detail: pair-switcher is a floating overlay, not a page-pushing block', () => {
  it('nests inside the positioned .detail-head (its anchor) and closes on outside click / Escape', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('#mk-pair-toggle') !== null);

    // Must be a DESCENDANT of .detail-head — CSS `position: absolute; top:
    // 100%` only anchors correctly below the header if it lives inside the
    // element that has `position: relative`, not merely next to it.
    const head = container.querySelector('.detail-head')!;
    const menu = container.querySelector('#mk-pair-menu')!;
    expect(head.contains(menu)).toBe(true);

    container.querySelector<HTMLButtonElement>('#mk-pair-toggle')!.click();
    expect(menu.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#mk-pair-toggle')!.getAttribute('aria-expanded')).toBe('true');

    // Tapping something else on the page (not the toggle, not the menu) closes it.
    container.querySelector('.detail-stats-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.hasAttribute('hidden')).toBe(true);

    container.querySelector<HTMLButtonElement>('#mk-pair-toggle')!.click();
    expect(menu.hasAttribute('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hasAttribute('hidden')).toBe(true);
    handle.pause();
  });
});

describe('Coin detail: coin logo has the same broken-image fallback as the list', () => {
  it('swaps a failed image for the letter tile instead of leaving a broken <img>', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('.detail-coin img.coin-logo') !== null);

    const img = container.querySelector('.detail-coin img.coin-logo')!;
    img.dispatchEvent(new Event('error'));
    expect(container.querySelector('.detail-coin img.coin-logo')).toBeNull();
    expect(container.querySelector('.detail-coin .coin-logo-tile')).not.toBeNull();
    handle.pause();
  });
});

describe('Coin detail: opening it resets scroll to the top', () => {
  it('scrolls to top on open, so the header cannot render off-screen after scrolling the list', async () => {
    // Real-device bug (found via a Playwright rect measurement at 844x390
    // landscape): the Markets list is long enough to scroll, but opening a
    // coin's detail from a scrolled position never reset the window's
    // scroll, so the detail header (back/pair-switcher/star) could render
    // partially or fully above the viewport. Every other view transition in
    // this app (activateView/openTool in main.ts) already resets scroll —
    // this is the one that didn't.
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    (container.querySelector('.market-row') as HTMLElement).click();
    await waitFor(() => container.querySelector('.detail-name') !== null);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    handle.pause();
  });
});
