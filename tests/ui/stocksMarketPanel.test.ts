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
});
