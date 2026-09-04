// @vitest-environment happy-dom
/**
 * The shared asset-hub shell (Crypto/Stocks) — specifically the optional
 * 5th "Long-Term" sub-tab (see `stocksLongTermPanel.ts`). Only Stocks passes
 * `renderLongTerm`; Crypto doesn't have a long-term shadow wallet yet, so
 * the tab must not appear at all when the option is omitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAssetHub } from '../../src/ui/views/assetHubView';
import type { CloudState } from '../../src/ui/cloudState';

function cloudState(overrides: Partial<CloudState> = {}): CloudState {
  return {
    cash: 100,
    initialCash: 100,
    baseCurrency: 'USD',
    positions: [],
    history: [],
    lastRunAt: null,
    benchmark: null,
    equityHistory: [],
    readiness: null,
    marketSnapshot: [],
    shadowStandings: [],
    live: null,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ 'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' } }) }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const baseOpts = {
  title: 'Stocks',
  subtitle: 'sub',
  currencySymbol: '$',
  fetchState: async () => null,
  showBenchmark: false,
  renderOverview: () => undefined,
  renderMarket: () => undefined,
};

describe('renderAssetHub — optional Long-Term sub-tab', () => {
  it('omits the tab and panel entirely when renderLongTerm is not provided (crypto today)', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, baseOpts);

    expect(container.querySelector('[data-hub="longterm"]')).toBeNull();
    expect(container.querySelector('[data-hub-panel="longterm"]')).toBeNull();
  });

  it('shows the tab and lazily mounts the panel exactly once when clicked (stocks)', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    let mounts = 0;
    renderAssetHub(container, {
      ...baseOpts,
      renderLongTerm: (panel) => {
        mounts++;
        panel.textContent = 'long-term panel content';
        return undefined;
      },
    });

    const tabBtn = container.querySelector<HTMLButtonElement>('[data-hub="longterm"]');
    expect(tabBtn).not.toBeNull();
    expect(mounts).toBe(0); // not mounted until clicked

    tabBtn!.click();
    expect(mounts).toBe(1);
    expect(container.querySelector('[data-hub-panel="longterm"]')!.textContent).toBe('long-term panel content');
    expect(container.querySelector('[data-hub-panel="longterm"]')!.classList.contains('active')).toBe(true);
    expect(tabBtn!.classList.contains('active')).toBe(true);

    tabBtn!.click(); // clicking again must not remount
    expect(mounts).toBe(1);
  });

  it('highlights the correct tab pill when a deep-link button elsewhere on the page (not itself a .hub-tab) switches tabs (real bug: matched by object identity, not tab value)', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, {
      ...baseOpts,
      renderOverview: (panel) => {
        // Mirrors Home's own deep links ("See all" → history, "profit ›" on
        // the real-money hero): a button elsewhere on the page carrying
        // `data-hub`, distinct from any of the actual `.hub-tab` pills.
        panel.innerHTML = '<button class="deep-link" data-hub="profit">profit ›</button>';
        return undefined;
      },
    });

    container.querySelector<HTMLButtonElement>('.deep-link')!.click();
    expect(container.querySelector('[data-hub-panel="profit"]')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-hub="profit"].hub-tab')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-hub="overview"].hub-tab')!.classList.contains('active')).toBe(false);
  });
});

describe('renderAssetHub — real-money sections on History and Profit (real bug, 2026-09-03)', () => {
  // David reported the real wallet "still isn't reflected everywhere" — the
  // real-money card had only ever been added to the Overview tab (homeView.ts);
  // History and Profit showed only the SIMULATED chart/return with no real
  // counterpart at all, easy to mistake for a stale/broken real balance.
  it('hides the real-activity and real-money sections entirely when there is no live account (e.g. Stocks)', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, { ...baseOpts, fetchState: async () => cloudState({ live: null }) });
    await flush();

    expect(container.querySelector<HTMLElement>('#hub-real-activity')!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('#hub-real-money')!.hidden).toBe(true);
  });

  it('shows real activity on History and real equity on Profit once a live account exists', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, {
      ...baseOpts,
      fetchState: async () =>
        cloudState({
          live: {
            cash: 50,
            positions: [{ symbol: 'XBTEUR', quantity: 0.001, entryPrice: 95_000, stopLoss: 90_000, takeProfit: 105_000, openedAt: 1 }],
            killSwitchEngaged: false,
            killSwitchReason: null,
            recentEvents: [{ at: 1_700_000_000_000, event: 'rejected', detail: 'Insufficient balance' }],
            externalBtcQuantity: 0,
            equityHistory: [],
          },
        }),
    });
    await flush();

    expect(container.querySelector<HTMLElement>('#hub-real-activity')!.hidden).toBe(false);
    expect(container.querySelector('#hub-real-activity-list')!.textContent).toContain('Insufficient balance');
    expect(container.querySelector<HTMLElement>('#hub-real-money')!.hidden).toBe(false);
    // No equity-history point yet, so falls back to 50 cash + 0.001 * 95000 invested = 145
    expect(container.querySelector('#hub-real-equity')!.textContent).toContain('145');
  });

  it('shows the untracked-BTC breakdown and feeds the real equity chart once external BTC and history exist', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, {
      ...baseOpts,
      fetchState: async () =>
        cloudState({
          marketSnapshot: [{ symbol: 'XBTEUR', price: 100_000, changePct: 1, updatedAt: 1 }],
          live: {
            cash: 50,
            positions: [],
            killSwitchEngaged: false,
            killSwitchReason: null,
            recentEvents: [],
            externalBtcQuantity: 0.001,
            equityHistory: [
              { at: 1, equity: 100 },
              { at: 2, equity: 150 },
            ],
          },
        }),
    });
    await flush();

    // Server-recorded equity (150) wins over the local cash-only fallback.
    expect(container.querySelector('#hub-real-equity')!.textContent).toContain('150');
    const breakdown = container.querySelector<HTMLElement>('#hub-real-breakdown')!;
    expect(breakdown.hidden).toBe(false);
    // 0.001 BTC * 100,000 = 100 EUR untracked holding value.
    expect(breakdown.textContent).toContain('100');
  });
});

describe("renderAssetHub — Profit tab 'leading vs Bitcoin' (found in review, 2026-09-03: used to mean merely profitable, not actually beating BTC's own return)", () => {
  function bitcoinScenario(overrides: { agentEquity: number; btcAnchor: number; btcNow: number }): CloudState {
    return cloudState({
      cash: overrides.agentEquity,
      initialCash: 100,
      equityHistory: [{ at: 1, equity: overrides.agentEquity }],
      benchmark: { btc: overrides.btcAnchor, equity: 100 },
      marketSnapshot: [{ symbol: 'XBTEUR', price: overrides.btcNow, changePct: 0, updatedAt: 1 }],
    });
  }

  it("does NOT show 'leading' when the agent is profitable but Bitcoin gained even more over the same window", async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    // Agent +10% (100 -> 110), but BTC +50% (100 -> 150) over the same window.
    renderAssetHub(container, {
      ...baseOpts,
      showBenchmark: true,
      fetchState: async () => bitcoinScenario({ agentEquity: 110, btcAnchor: 100, btcNow: 150 }),
    });
    await flush();

    const bench = container.querySelector<HTMLElement>('#hub-bench')!;
    expect(bench.hidden).toBe(false);
    expect(bench.textContent).toContain('agent +10');
    expect(bench.textContent).toContain('BTC +50');
    expect(bench.textContent).not.toContain('leading');
  });

  it("shows 'leading' only when the agent's return actually beats BTC's own return", async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    // Agent +10%, BTC only +2% over the same window.
    renderAssetHub(container, {
      ...baseOpts,
      showBenchmark: true,
      fetchState: async () => bitcoinScenario({ agentEquity: 110, btcAnchor: 100, btcNow: 102 }),
    });
    await flush();

    const bench = container.querySelector<HTMLElement>('#hub-bench')!;
    expect(bench.textContent).toContain('leading');
  });
});

describe("renderAssetHub — persistent fetch failure (found in review, 2026-09-03: panels started on their own 'Loading…'/blank skeleton and nothing ever replaced it)", () => {
  it("replaces the History tab's 'Loading…' placeholder with an error message instead of leaving it stuck forever", async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, { ...baseOpts, fetchState: async () => null });
    await flush();

    const list = container.querySelector('#hub-history-list')!;
    expect(list.textContent).not.toContain('Loading');
    expect(list.textContent).toContain("Couldn't reach the cloud agent");
  });

  it('recovers normally once the fetch succeeds after an earlier failure', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    let succeed = false;
    const handle = renderAssetHub(container, { ...baseOpts, fetchState: async () => (succeed ? cloudState() : null) });
    await flush();
    expect(container.querySelector('#hub-history-list')!.textContent).toContain("Couldn't reach the cloud agent");

    succeed = true;
    handle.resume?.();
    await flush();
    expect(container.querySelector('#hub-history-list')!.textContent).toContain('No trades yet');
  });
});
