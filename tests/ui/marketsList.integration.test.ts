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

  it('renders one page of rows up front, not all several hundred', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);

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

    disconnect.mockClear();
    handle.pause();
    expect(disconnect).toHaveBeenCalled();
  });
});
