// @vitest-environment happy-dom
/**
 * Operations Console — Strategies. Everything here is simulated; the
 * screen must never suggest a single "winner" and must show sample-size
 * context rather than silently hiding a too-small comparison.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStrategiesView } from '../../src/ui/views/strategiesView';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(standings: unknown[]): void {
  const raw = {
    'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'EUR' },
    'open-positions': [],
    'audit-log': [],
    'shadow-standings': { standings },
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Strategies (DOM integration)', () => {
  it('labels the whole screen as simulation, never real money', async () => {
    stubState([]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStrategiesView(container);

    await waitFor(() => container.querySelector('#sv-status')!.textContent!.startsWith('Updated'));
    expect(container.textContent).toContain('SHADOW');
    expect(container.textContent).toContain('SIMULATION');
    expect(container.textContent).toContain('NO REAL MONEY');
  });

  it('flags a below-threshold challenger as not yet comparable, with the reason and sample-size context visible', async () => {
    stubState([
      { key: 'live-mirror', label: 'Champion', equity: 1000, returnPct: 5, trades: 30, winRatePct: 55, profitFactor: 1.3, openPositions: 0, startedAt: 0 },
      { key: 'challenger-a', label: 'Challenger A', equity: 1000, returnPct: 8, trades: 12, winRatePct: 60, profitFactor: 1.5, openPositions: 0, startedAt: 0 },
    ]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStrategiesView(container);

    await waitFor(() => container.querySelector('#sv-status')!.textContent!.startsWith('Updated'));
    expect(container.textContent).toContain('12 closed trades');
    expect(container.textContent).toContain('Minimum evaluation sample');
    expect(container.textContent).toContain('Not yet meaningful');
    expect(container.textContent).toContain('not yet comparable');
    // Never a single "winner" verdict.
    expect(container.textContent).not.toMatch(/winner/i);
    expect(container.textContent).not.toMatch(/best strategy/i);
  });

  it('reports which named metrics each side leads on once both are past the meaningful-trades bar, never a single score', async () => {
    stubState([
      { key: 'live-mirror', label: 'Champion', equity: 1000, returnPct: 5, trades: 25, winRatePct: 50, profitFactor: 1.2, openPositions: 0, startedAt: 0 },
      { key: 'challenger-a', label: 'Challenger A', equity: 1000, returnPct: 8, trades: 25, winRatePct: 45, profitFactor: 1.4, openPositions: 0, startedAt: 0 },
    ]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStrategiesView(container);

    await waitFor(() => container.querySelector('#sv-status')!.textContent!.startsWith('Updated'));
    expect(container.textContent).toContain('Ahead on');
    expect(container.textContent).toContain('Return, Profit factor');
    expect(container.textContent).toContain('Behind on');
    expect(container.textContent).toContain('Win rate');
  });
});
