/**
 * Stocks Overview sub-page: current portfolio value and open positions, off
 * the committed `state/stocks-state.json`. The equity chart and trade list
 * live on the History sub-page instead (see `assetHubView.ts`).
 */

import { fetchStocksState } from '../cloudState';
import { sparklineSvg } from '../charts';
import { attachCoinLogoFallback } from '../coinLogo';
import { formatPrice, formatPct, formatPriceSplit } from '../format';
import { skeletonRowsHtml } from '../loadingStates';
import type { ViewHandle } from '../viewLifecycle';
import { buildHoldingsRows, holdingsTableHtml } from './homeView';

const REFRESH_MS = 60_000;
const dollar = (v: number): string => `$${formatPrice(v)}`;

export function renderStocksOverviewPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <!-- hero-bare matches Home's balance treatment (homeView.ts): this is
         the identical dominant-balance-of-the-screen pattern, so it gets
         the same bare, un-boxed, giant-scale treatment. -->
    <section class="hero hero-bare">
      <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span></div>
      <div class="hero-value" id="stocks-ov-equity">—</div>
      <div class="hero-change" id="stocks-ov-change"></div>
      <div class="hero-split"><span id="stocks-ov-cash"></span><span id="stocks-ov-invested"></span></div>
      <div class="hero-spark" id="stocks-ov-spark"></div>
    </section>
    <section class="block"><div class="block-head"><h2>Open positions</h2></div><div class="stack stack-card" id="stocks-ov-positions">${skeletonRowsHtml(2)}</div></section>
    <p class="muted-line" id="stocks-ov-status">Loading…</p>`;
  attachCoinLogoFallback(container);

  const heroEl = container.querySelector<HTMLElement>('.hero')!;
  const equityEl = container.querySelector<HTMLElement>('#stocks-ov-equity')!;
  const changeEl = container.querySelector<HTMLElement>('#stocks-ov-change')!;
  const cashEl = container.querySelector<HTMLElement>('#stocks-ov-cash')!;
  const investedEl = container.querySelector<HTMLElement>('#stocks-ov-invested')!;
  const sparkEl = container.querySelector<HTMLElement>('#stocks-ov-spark')!;
  const positionsEl = container.querySelector<HTMLElement>('#stocks-ov-positions')!;
  const statusEl = container.querySelector<HTMLElement>('#stocks-ov-status')!;
  let loadedOnce = false;

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    if (!state) {
      if (!loadedOnce) {
        statusEl.textContent = 'Waiting for the stocks agent — set up ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY as GitHub Actions secrets to start it (see PROJECT_STATE.md).';
        // Swap the shimmering skeleton for an honest message — left alone
        // it would shimmer forever until the agent's first successful run.
        positionsEl.innerHTML = '';
        positionsEl.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Waiting for the stocks agent…' }));
      }
      return;
    }
    loadedOnce = true;
    const equity = state.equityHistory.at(-1)?.equity ?? state.cash;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;
    const { major, minor } = formatPriceSplit(equity);
    equityEl.innerHTML = `<span class="hero-value-currency">$</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
    changeEl.textContent = `${formatPct(totalReturn)} all time`;
    changeEl.className = `hero-change ${totalReturn >= 0 ? 'up' : 'down'}`;
    cashEl.textContent = `Cash ${dollar(state.cash)}`;
    investedEl.textContent = `Invested ${dollar(equity - state.cash)}`;
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `Live · updated ${stamp}`;

    if (state.equityHistory.length >= 2) {
      const values = state.equityHistory.map((e) => e.equity);
      const up = values[values.length - 1]! >= values[0]!;
      heroEl.classList.toggle('up', up);
      heroEl.classList.toggle('down', !up);
      sparkEl.innerHTML = sparklineSvg(values, { stroke: 'var(--accent-text)', fill: false, width: 320, height: 64 });
    } else {
      sparkEl.innerHTML = '';
      heroEl.classList.remove('up', 'down');
    }

    // Same Cash/Total/Price/Value/Allocation/Unrealised-P&L table as Home's
    // crypto positions (buildHoldingsRows/holdingsTableHtml) — "open
    // positions" should look identical everywhere, dollars instead of
    // euros. Prices come from the periodic market-snapshot (not live
    // per-tick, see the file header), same source stocksMarketPanel uses.
    const prices: Record<string, number> = {};
    for (const s of state.marketSnapshot) prices[s.symbol] = s.price;
    positionsEl.innerHTML = holdingsTableHtml(
      buildHoldingsRows(state.cash, state.positions, prices, equity, (sym) => sym, dollar, 'USD'),
      dollar,
    );
    if (state.positions.length === 0) {
      positionsEl.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Holding cash — no open positions.' }));
    }
  }

  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), REFRESH_MS);

  return {
    pause: () => window.clearInterval(timer),
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), REFRESH_MS);
    },
  };
}
