// @vitest-environment happy-dom
/**
 * A market/timeframe combo can legitimately resolve `ok: true` with zero
 * candles (no history yet). Without a guard, `Math.min(...[])` /
 * `Math.max(...[])` silently produce `Infinity`/`-Infinity` grid bounds
 * instead of a clear "no data" message.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderGridView } from '../../src/ui/views/gridView';

function fakeSource(candles: MarketDataSource['getCandles']): ActiveDataSource {
  const source: MarketDataSource = {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [{ symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' }] }),
    getCandles: candles,
  };
  return { source, instruments: [{ symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' }], isLive: false, kind: 'demo', diagnostics: [] };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Grid view — empty candle history', () => {
  it('shows a clear message instead of an Infinity/-Infinity grid range', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: [] })));

    container.querySelector<HTMLButtonElement>('#grid-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const status = container.querySelector('#grid-status')!;
    expect(status.textContent).not.toContain('Infinity');
    expect(status.textContent?.toLowerCase()).toContain('no history');
  });
});

describe('Grid view — win rate / drawdown formatting', () => {
  it('never shows a "+" on win rate or a negative-zero drawdown', async () => {
    const candles = generateSyntheticCandles({
      seed: 3, startPrice: 100, count: 200, timeframe: '1h',
      startTimestamp: 1_700_000_000_000, drift: 0.001, volatility: 0.01,
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: candles })));

    container.querySelector<HTMLButtonElement>('#grid-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const results = container.querySelector('#grid-results')!;
    expect(results.textContent).not.toMatch(/-0\.00%/);
    expect(results.textContent).not.toMatch(/\+\d+%/); // win rate must not carry a "+"
  });
});

describe('Grid view — result presentation', () => {
  it('renders an equity curve alongside the stat tiles, not just five numbers', async () => {
    const candles = generateSyntheticCandles({
      seed: 3, startPrice: 100, count: 200, timeframe: '1h',
      startTimestamp: 1_700_000_000_000, drift: 0.001, volatility: 0.01,
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: candles })));

    container.querySelector<HTMLButtonElement>('#grid-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const results = container.querySelector('#grid-results')!;
    expect(results.querySelector('svg.equity-curve')).not.toBeNull();
    // Final equity and Return lead as their own hero-ish row, ahead of the
    // curve; the supporting metrics (drawdown/trades/win rate) follow it.
    const tiles = results.querySelectorAll('.stat-tile-label');
    expect([...tiles].map((t) => t.textContent)).toEqual([
      'Final equity', 'Return', 'Max drawdown', 'Closed trades', 'Win rate',
    ]);
  });
});

describe('Grid view — Configure/Results section structure', () => {
  it('groups the form under a Configure heading and results under a Results heading, with an empty state before the first run', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: [] })));

    const headings = [...container.querySelectorAll('.block-head h2')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Configure', 'Results SIMULATED']);
    expect(container.querySelector('#grid-results .empty')?.textContent).toMatch(/press Simulate/i);
  });
});

describe('Grid view — loading state', () => {
  it('shows the shared spinner while candle history loads, matching Backtest\'s own treatment', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: [] })));

    container.querySelector<HTMLButtonElement>('#grid-run')!.click();
    // The status update happens synchronously before the first `await`, so
    // it's already on screen the instant .click() returns — no need to wait.
    const status = container.querySelector('#grid-status')!;
    expect(status.querySelector('.spinner')).not.toBeNull();
    expect(status.textContent).toContain('Loading');
  });
});

describe('Grid view — final equity tabular-price treatment', () => {
  it('gives the Final equity tile the same two-tier decimal styling money values get elsewhere', async () => {
    const candles = generateSyntheticCandles({
      seed: 3, startPrice: 100, count: 200, timeframe: '1h',
      startTimestamp: 1_700_000_000_000, drift: 0.001, volatility: 0.01,
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderGridView(container, fakeSource(async () => ({ ok: true, value: candles })));

    // A small initial cash keeps final equity under 1000, where formatPrice
    // actually carries a decimal point for tieredPriceHtml to split.
    container.querySelector<HTMLInputElement>('#grid-cash')!.value = '80';
    container.querySelector<HTMLButtonElement>('#grid-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const value = container.querySelector('#grid-results .stat-tile-value')!;
    expect(value.querySelector('.tiered-price')).not.toBeNull();
    expect(value.querySelector('.tiered-minor')).not.toBeNull();
  });
});
