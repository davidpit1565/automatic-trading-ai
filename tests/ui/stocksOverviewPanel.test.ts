// @vitest-environment happy-dom
/**
 * Stocks Overview sub-page (`stocksOverviewPanel.ts`). Covers the two DOM
 * behaviors this design pass added: the dominant hero balance jumping to
 * this hub's own History sub-tab on tap (matching homeView.ts's identical
 * hero, which jumps to its own Value view the same way), and the "vs S&P
 * 500" benchmark line surfacing `benchmark-result` from the state file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderStocksOverviewPanel } from '../../src/ui/views/stocksOverviewPanel';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(extra: Record<string, unknown> = {}): void {
  const raw: Record<string, unknown> = {
    'portfolio-engine': { cash: 4000, initialCash: 10_000, baseCurrency: 'USD' },
    'open-positions': [],
    'audit-log': [],
    'equity-history': [
      { at: 1, equity: 9800 },
      { at: 2, equity: 10_530 },
    ],
    ...extra,
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Stocks Overview panel (DOM integration)', () => {
  it('tags "Open positions" as SIMULATED, matching Home\'s identical heading', async () => {
    stubState();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksOverviewPanel(container);
    await waitFor(() => container.querySelector('#stocks-ov-equity')!.textContent !== '—');

    const heading = container.querySelector('.block-head h2')!;
    expect(heading.textContent).toContain('Open positions');
    expect(heading.querySelector('.tag-sim')).not.toBeNull();
  });

  it('clicking the dominant hero balance activates the hub\'s own History tab', async () => {
    stubState();
    // The hero's click handler walks up to its parent looking for the hub's
    // own tab buttons (see assetHubView.ts) — reproduce that sibling
    // structure rather than mounting the panel in isolation.
    const hubRoot = document.createElement('div');
    hubRoot.innerHTML = '<div class="hub-tabs"><button class="hub-tab" data-hub="history">History</button></div>';
    const panel = document.createElement('div');
    hubRoot.appendChild(panel);
    document.body.appendChild(hubRoot);

    renderStocksOverviewPanel(panel);
    await waitFor(() => panel.querySelector('#stocks-ov-equity')!.textContent !== '—');

    const historyTab = hubRoot.querySelector<HTMLButtonElement>('[data-hub="history"]')!;
    let clicked = false;
    historyTab.addEventListener('click', () => {
      clicked = true;
    });

    const hero = panel.querySelector<HTMLElement>('.hero')!;
    hero.click();
    expect(clicked).toBe(true);
    // Same gap as Home's identical hero (homeView.ts): a <section> with a
    // click handler is invisible to the Tab key and inert on Enter/Space
    // without these — role="button" opts it into the app's global
    // keyboard-activation delegate (main.ts), proven end-to-end there.
    expect(hero.getAttribute('role')).toBe('button');
    expect(hero.tabIndex).toBe(0);
  });

  it('shows the "vs S&P 500" benchmark line once benchmark-result is present, hidden otherwise', async () => {
    stubState({ 'benchmark-result': { label: 'S&P 500 (SPY)', portfolioPct: 0.63, assetPct: 0.9 } });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksOverviewPanel(container);
    await waitFor(() => container.querySelector('#stocks-ov-equity')!.textContent !== '—');

    const bench = container.querySelector<HTMLElement>('#stocks-ov-bench')!;
    expect(bench.hidden).toBe(false);
    expect(bench.textContent).toContain('vs S&P 500');
    expect(bench.textContent).toContain('SPY');
    expect(bench.textContent).toContain('+0.63%');
    expect(bench.textContent).toContain('+0.90%');
  });

  it('hides the benchmark line when benchmark-result is absent', async () => {
    stubState();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderStocksOverviewPanel(container);
    await waitFor(() => container.querySelector('#stocks-ov-equity')!.textContent !== '—');

    expect(container.querySelector<HTMLElement>('#stocks-ov-bench')!.hidden).toBe(true);
  });
});
