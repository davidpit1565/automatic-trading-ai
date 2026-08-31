// @vitest-environment happy-dom
/**
 * Stocks "Long-Term" sub-page — the long-term investing shadow wallet
 * (see `stocksLongTermPanel.ts` / `shadowEvaluator.ts`). Reads the same
 * `state/stocks-state.json` shape as the rest of the Stocks hub, via the
 * `'shadow-standings'` key `server/stocksRunner.mts` writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStocksLongTermPanel } from '../../src/ui/views/stocksLongTermPanel';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(shadowStandings?: unknown): void {
  const raw: Record<string, unknown> = {
    'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD' },
    'open-positions': [],
    'audit-log': [],
  };
  if (shadowStandings !== undefined) raw['shadow-standings'] = shadowStandings;
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Stocks Long-Term panel (DOM integration)', () => {
  it('shows "not started yet" when the shadow cycle has never run', async () => {
    stubState(undefined);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksLongTermPanel(container);

    await waitFor(() => container.textContent!.includes('Not started yet'));
    expect(container.querySelector('#lt-equity')!.textContent).toBe('—');
  });

  it('renders equity and return once the long-term candidate has a standing, gated as "still gathering data" below the meaningful-trades bar', async () => {
    stubState({
      at: Date.now(),
      standings: [
        {
          key: 'long-term', label: 'Long-term investing', equity: 10_530.5, returnPct: 5.3,
          trades: 4, winRatePct: 100, profitFactor: null, openPositions: 1, startedAt: 0,
        },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksLongTermPanel(container);

    await waitFor(() => container.querySelector('#lt-equity')!.textContent !== '—');
    expect(container.querySelector('#lt-equity')!.textContent).toContain('10,530');
    expect(container.querySelector('#lt-change')!.textContent).toContain('+5.30%');
    expect(container.querySelector('#lt-change')!.className).toContain('up');
    expect(container.querySelector('#lt-trades')!.textContent).toBe('4 trades');
    expect(container.textContent).toContain('Still gathering data');
    expect(container.textContent).toContain('4/20');
    // Not enough trades yet to show a win-rate/profit-factor verdict.
    expect(container.textContent).not.toContain('Win rate');
  });

  it('reports win rate and profit factor once past the meaningful-trades bar', async () => {
    stubState({
      at: Date.now(),
      standings: [
        {
          key: 'long-term', label: 'Long-term investing', equity: 9_400, returnPct: -6,
          trades: 25, winRatePct: 40, profitFactor: 0.9, openPositions: 0, startedAt: 0,
        },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksLongTermPanel(container);

    await waitFor(() => container.querySelector('#lt-equity')!.textContent !== '—');
    expect(container.querySelector('#lt-change')!.textContent).toContain('-6.00%');
    expect(container.querySelector('#lt-change')!.className).toContain('down');
    expect(container.textContent).toContain('Win rate');
    expect(container.textContent).toContain('40.0%');
    expect(container.textContent).toContain('Profit factor');
    expect(container.textContent).toContain('0.90');
  });

  it('ignores a shadow candidate that is not the long-term key', async () => {
    stubState({
      at: Date.now(),
      standings: [
        { key: 'other-candidate', label: 'Something else', equity: 11_000, returnPct: 10, trades: 30, winRatePct: 80, profitFactor: 2, openPositions: 0, startedAt: 0 },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksLongTermPanel(container);

    await waitFor(() => container.textContent!.includes('Not started yet'));
    expect(container.querySelector('#lt-equity')!.textContent).toBe('—');
  });
});
