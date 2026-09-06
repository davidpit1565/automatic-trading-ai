// @vitest-environment happy-dom
/**
 * Win rate and max drawdown are plain 0-100% magnitudes, not signed deltas —
 * rendering them through the signed-delta formatter produced a spurious
 * "+" on win rate and, for a near-zero drawdown, a confusing "-0.00%".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderBacktestView } from '../../src/ui/views/backtestView';

const INSTRUMENT = { symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' };

function fakeData(): ActiveDataSource {
  const candles = generateSyntheticCandles({
    seed: 7, startPrice: 100, count: 200, timeframe: '1d',
    startTimestamp: 1_700_000_000_000, drift: 0.001, volatility: 0.01,
  });
  const source: MarketDataSource = {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [INSTRUMENT] }),
    getCandles: async () => ({ ok: true, value: candles }),
  };
  return { source, instruments: [INSTRUMENT], isLive: false, kind: 'demo', diagnostics: [] };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Backtest view — win rate / drawdown formatting', () => {
  it('never shows a "+" on win rate or a negative-zero drawdown', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderBacktestView(container, fakeData());

    container.querySelector<HTMLButtonElement>('#bt-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const table = container.querySelector('#bt-results')!;
    expect(table.textContent).not.toMatch(/-0\.00%/);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const winRateCell = cells[5]!.textContent ?? '';
      if (winRateCell !== '—') expect(winRateCell.startsWith('+')).toBe(false);
      const drawdownCell = cells[3]!.textContent ?? '';
      expect(drawdownCell.startsWith('+')).toBe(false);
    }
  });
});

describe('Backtest view — Best strategy tile color', () => {
  it('colors the "Best strategy" name tile the same as the adjacent "Best return" tile, not a hardcoded green', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderBacktestView(container, fakeData());

    container.querySelector<HTMLButtonElement>('#bt-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const tiles = container.querySelectorAll('#bt-results .stat-tile-value');
    const bestStrategyClass = tiles[0]!.className;
    const bestReturnClass = tiles[1]!.className;
    // Both are driven by the exact same `bestReturn >= 0` sign — whatever it
    // resolves to for this run, the two tiles must agree, so a strategy
    // that's merely the "least bad" of a losing bunch is never shown green.
    expect(bestStrategyClass).toBe(bestReturnClass);
    expect(bestStrategyClass).toMatch(/\b(up|down)\b/);
  });
});

describe('Backtest view — table scroll-fade affordance', () => {
  it('flags the wrapper as scrollable and tracks scroll position, without touching the shared .table-scroll wrapper', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderBacktestView(container, fakeData());

    container.querySelector<HTMLButtonElement>('#bt-run')!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const fadeWrap = container.querySelector<HTMLElement>('.table-scroll-fade')!;
    const scroller = fadeWrap.querySelector<HTMLElement>('.table-scroll')!;
    expect(fadeWrap).not.toBeNull();

    // Simulate a wide table that overflows its container (happy-dom does no
    // real layout, so scrollWidth/clientWidth are stubbed here).
    Object.defineProperty(scroller, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true, writable: true });
    scroller.dispatchEvent(new Event('scroll'));
    expect(fadeWrap.classList.contains('is-scrollable')).toBe(true);
    expect(fadeWrap.classList.contains('is-scrolled-end')).toBe(false);

    (scroller as unknown as { scrollLeft: number }).scrollLeft = 500;
    scroller.dispatchEvent(new Event('scroll'));
    expect(fadeWrap.classList.contains('is-scrolled-end')).toBe(true);
  });
});
