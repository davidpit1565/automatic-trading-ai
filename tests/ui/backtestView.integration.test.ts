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
