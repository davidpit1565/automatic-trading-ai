// @vitest-environment happy-dom
/**
 * Regression test for a real bug: the Gainers/Losers category tabs must show
 * rows ranked by change magnitude by default, not re-sorted alphabetically.
 * `sortRows`'s initial 'default' key has to be a true no-op that preserves
 * whatever order `applyCategory` already built — see the comment on
 * `sortRows` in stocksMarketPanel.ts for why 'name' as the initial key broke
 * this (it silently re-sorted every category back to A-Z).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStocksMarketPanel } from '../../src/ui/views/stocksMarketPanel';
import { BROWSABLE_STOCK_INSTRUMENTS, CURATED_STOCK_INSTRUMENTS } from '../../src/core/data/alpacaStocks';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Stocks Market panel — category/sort interaction (DOM integration)', () => {
  it('ranks the Gainers tab by change magnitude, not alphabetically, before the user touches Sort', async () => {
    // AAPL, ABBV, ADBE are the first three BROWSABLE_STOCK_INSTRUMENTS (see
    // alpacaStocks.ts) — deliberately give the alphabetically-LAST one of the
    // three the BIGGEST gain, so an alphabetical re-sort and a magnitude sort
    // disagree on the order and the bug can't hide.
    const [first, second, third] = BROWSABLE_STOCK_INSTRUMENTS;
    const now = Date.now();
    const raw = {
      'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD' },
      'open-positions': [],
      'audit-log': [],
      'market-snapshot': {
        at: now,
        symbols: [
          { symbol: first!.symbol, price: 100, changePct: 1, updatedAt: now },
          { symbol: second!.symbol, price: 100, changePct: 2, updatedAt: now },
          { symbol: third!.symbol, price: 100, changePct: 9, updatedAt: now },
        ],
      },
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));

    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksMarketPanel(container);
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLButtonElement>('[data-cat="gainers"]')!.click();
    await waitFor(() => container.querySelectorAll('.market-row').length > 0);

    const symbolsInOrder = Array.from(container.querySelectorAll('.row-title')).map((el) => el.textContent);
    expect(symbolsInOrder.slice(0, 3)).toEqual([third!.symbol, second!.symbol, first!.symbol]);
  });

  it('marks the curated (actually-traded) majors with the same TRADED badge the crypto Markets list uses', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksMarketPanel(container);
    await waitFor(() => container.querySelector('.market-row') !== null);
    container.querySelector<HTMLButtonElement>('[data-cat="all"]')!.click();
    await waitFor(() => container.querySelectorAll('.market-row').length === BROWSABLE_STOCK_INSTRUMENTS.length);

    const rows = [...container.querySelectorAll('.market-row')];
    const curatedSymbols = new Set(CURATED_STOCK_INSTRUMENTS.map((i) => i.symbol));
    for (const row of rows) {
      const symbol = row.querySelector('.row-title')!.textContent!;
      const badge = row.querySelector('.tag-traded');
      expect(badge !== null).toBe(curatedSymbols.has(symbol));
    }
  });

  it('echoes the search query back in the empty state, not a generic message', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksMarketPanel(container);
    await waitFor(() => container.querySelector('.market-row') !== null);

    container.querySelector<HTMLInputElement>('#sm-search')!.value = 'zzz-no-such-stock';
    container.querySelector<HTMLInputElement>('#sm-search')!.dispatchEvent(new Event('input'));
    expect(container.textContent).toContain('No stocks match "zzz-no-such-stock"');
  });

  it('shows a live status line with a priced count and timestamp, like the crypto Markets list', async () => {
    const now = Date.now();
    const [first] = BROWSABLE_STOCK_INSTRUMENTS;
    const raw = {
      'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD' },
      'open-positions': [],
      'audit-log': [],
      'market-snapshot': { symbols: [{ symbol: first!.symbol, price: 100, changePct: 1, updatedAt: now }] },
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksMarketPanel(container);
    await waitFor(() => (container.querySelector('#sm-status')?.textContent ?? '').includes('priced'));

    const status = container.querySelector('#sm-status')!.textContent!;
    expect(status).toContain(`1/${BROWSABLE_STOCK_INSTRUMENTS.length} stocks priced`);
  });

  it('keeps showing the last good prices (and an honest status) instead of wiping the list when a later refresh fails', async () => {
    const [first] = BROWSABLE_STOCK_INSTRUMENTS;
    const now = Date.now();
    const goodRaw = {
      'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD' },
      'open-positions': [],
      'audit-log': [],
      'market-snapshot': { symbols: [{ symbol: first!.symbol, price: 123.45, changePct: 1, updatedAt: now }] },
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(goodRaw) }));
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderStocksMarketPanel(container);
    await waitFor(() => (container.querySelector('#sm-status')?.textContent ?? '').includes('1/'));
    expect(container.querySelector('.row-price')!.textContent).toContain('123.45');

    // The cloud agent's state feed goes unreachable on a later poll — real
    // rows already on screen must not revert to "no data yet", and the
    // status line must not silently reset to the misleading
    // "Live · 0/N stocks priced" it used to show (per the same
    // stale-data-on-error convention valueView.ts uses: a background
    // failure after the first success stays quiet rather than re-alarming).
    const statusBefore = container.querySelector('#sm-status')!.textContent;
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
    await handle.resume?.();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(container.querySelector('.row-price')!.textContent).toContain('123.45');
    expect(container.querySelector('#sm-status')!.textContent).not.toContain('0/');
    expect(container.querySelector('#sm-status')!.textContent).toBe(statusBefore);
  });

  it('shows the honest "Couldn\'t reach the cloud agent" status on a first-load failure, not the misleading "Live · 0/N" line', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksMarketPanel(container);
    await waitFor(() => (container.querySelector('#sm-status')?.textContent ?? '') !== '');

    const status = container.querySelector('#sm-status')!.textContent!;
    expect(status).toContain("Couldn't reach the cloud agent");
    expect(status).not.toContain('Live ·');
  });

  it('flashes a row whose price actually changed since the previous render, like the crypto Markets list', async () => {
    const [first] = BROWSABLE_STOCK_INSTRUMENTS;
    let price = 100;
    const raw = () => ({
      'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD' },
      'open-positions': [],
      'audit-log': [],
      'market-snapshot': { symbols: [{ symbol: first!.symbol, price, changePct: 1, updatedAt: Date.now() }] },
    });
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw()) }));
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderStocksMarketPanel(container);
    await waitFor(() => container.querySelector('.row-price') !== null);
    expect(container.querySelector('.row-price')!.className).not.toMatch(/flash-(up|down)/);

    price = 105;
    // Same closure's shownPrices Map, not a fresh mount — resume() is what
    // the real pause/resume view lifecycle (and the refresh interval) call.
    await handle.resume?.();
    await waitFor(() => (container.querySelector('.row-price')?.className ?? '').includes('flash-up'));
    expect(container.querySelector('.row-price')!.className).toContain('flash-up');
  });
});
