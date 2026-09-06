// @vitest-environment happy-dom
/**
 * Buy/Sell used to stay enabled while `trade()` was in flight (fetching a
 * price is async), so a rapid double-click could fire two concurrent trades
 * from a single intended click.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderPortfolioView } from '../../src/ui/views/portfolioView';

const INSTRUMENT = { symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' };

function slowSource(): ActiveDataSource {
  let resolveCandles: (() => void) | null = null;
  const gate = new Promise<void>((r) => (resolveCandles = r));
  const source: MarketDataSource = {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [INSTRUMENT] }),
    getCandles: async () => {
      await gate; // stays pending until the test releases it
      return { ok: true, value: [{ timestamp: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 }] };
    },
  };
  (source as unknown as { _release: () => void })._release = () => resolveCandles?.();
  return { source, instruments: [INSTRUMENT], isLive: false, kind: 'demo', diagnostics: [] };
}

function readySource(): ActiveDataSource {
  const source: MarketDataSource = {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [INSTRUMENT] }),
    getCandles: async () => ({
      ok: true,
      value: [{ timestamp: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 }],
    }),
  };
  return { source, instruments: [INSTRUMENT], isLive: false, kind: 'demo', diagnostics: [] };
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('Portfolio view — currency symbol and zero-P&L colour', () => {
  it('shows the € symbol on the hero equity value, not a bare number', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderPortfolioView(container, readySource());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#pp-equity .hero-value-currency')!.textContent).toBe('€');
  });

  it('a fresh (unmoved) portfolio is neutral, not coloured green, at 0.00% all time', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderPortfolioView(container, readySource());
    await new Promise((r) => setTimeout(r, 0));
    const change = container.querySelector('#pp-change')!;
    expect(change.textContent).toContain('0.00%');
    expect(change.className).not.toMatch(/\b(up|down)\b/);
  });

  it('positions and trade journal rows show € too', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const data = readySource();
    renderPortfolioView(container, data);
    await new Promise((r) => setTimeout(r, 0));
    container.querySelector<HTMLButtonElement>('#pp-buy')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#pp-positions')!.textContent).toContain('€');
    expect(container.querySelector('#pp-trades')!.textContent).toContain('€');
  });
});

describe('Portfolio view — trade button re-entrancy', () => {
  it('disables Buy/Sell while a trade is in flight, and re-enables after', async () => {
    const data = slowSource();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderPortfolioView(container, data);
    await new Promise((r) => setTimeout(r, 0)); // let the initial refresh() settle

    const buy = container.querySelector<HTMLButtonElement>('#pp-buy')!;
    const sell = container.querySelector<HTMLButtonElement>('#pp-sell')!;
    expect(buy.disabled).toBe(false);

    buy.click();
    expect(buy.disabled).toBe(true);
    expect(sell.disabled).toBe(true);

    (data.source as unknown as { _release: () => void })._release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(buy.disabled).toBe(false);
    expect(sell.disabled).toBe(false);
  });
});

describe('Portfolio view — cross-screen copy parity', () => {
  // Round-2 cross-screen consistency: Home's and Stocks Overview's
  // identical empty-positions state both read "Holding cash and waiting for
  // a good setup."; Portfolio's own copy was the flatter, differently-worded
  // "No open positions." for the exact same concept.
  it('uses the same empty-positions copy as Home/Stocks Overview', async () => {
    const data = slowSource();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderPortfolioView(container, data);
    (data.source as unknown as { _release: () => void })._release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#pp-positions')!.textContent).toContain(
      'Holding cash and waiting for a good setup.',
    );
  });
});
