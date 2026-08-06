/**
 * Stocks Overview sub-page: current portfolio value and open positions, off
 * the committed `state/stocks-state.json`. The equity chart and trade list
 * live on the History sub-page instead (see `assetHubView.ts`).
 */

import { fetchStocksState } from '../cloudState';
import { formatPrice, formatPct } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
const dollar = (v: number): string => `$${formatPrice(v)}`;

export function renderStocksOverviewPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <section class="hero">
      <div class="hero-label">Portfolio value</div>
      <div class="hero-value" id="stocks-ov-equity">—</div>
      <div class="hero-change" id="stocks-ov-change"></div>
      <div class="hero-split"><span id="stocks-ov-cash"></span><span id="stocks-ov-invested"></span></div>
    </section>
    <section class="block"><div class="block-head"><h2>Open positions</h2></div><div class="stack" id="stocks-ov-positions"></div></section>
    <p class="muted-line" id="stocks-ov-status">Loading…</p>`;

  const equityEl = container.querySelector<HTMLElement>('#stocks-ov-equity')!;
  const changeEl = container.querySelector<HTMLElement>('#stocks-ov-change')!;
  const cashEl = container.querySelector<HTMLElement>('#stocks-ov-cash')!;
  const investedEl = container.querySelector<HTMLElement>('#stocks-ov-invested')!;
  const positionsEl = container.querySelector<HTMLElement>('#stocks-ov-positions')!;
  const statusEl = container.querySelector<HTMLElement>('#stocks-ov-status')!;
  let loadedOnce = false;

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    if (!state) {
      if (!loadedOnce) statusEl.textContent = 'Waiting for the stocks robot — set up ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY as GitHub Actions secrets to start it (see PROJECT_STATE.md).';
      return;
    }
    loadedOnce = true;
    const equity = state.equityHistory.at(-1)?.equity ?? state.cash;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;
    equityEl.textContent = dollar(equity);
    changeEl.textContent = `${formatPct(totalReturn)} all time`;
    changeEl.className = `hero-change ${totalReturn >= 0 ? 'up' : 'down'}`;
    cashEl.textContent = `Cash ${dollar(state.cash)}`;
    investedEl.textContent = `Invested ${dollar(equity - state.cash)}`;
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `Live · updated ${stamp}`;

    if (state.positions.length === 0) {
      positionsEl.innerHTML = '<div class="empty">No open positions — holding cash.</div>';
    } else {
      positionsEl.innerHTML = '';
      for (const p of state.positions) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
          <div class="row-main"><span class="row-title">${p.symbol}</span>
            <span class="row-sub">entry ${dollar(p.entryPrice)}</span></div>
          <div class="row-side"><span class="row-title">${p.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh</span></div>`;
        positionsEl.appendChild(row);
      }
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
