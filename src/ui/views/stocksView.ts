/**
 * Stocks — the separate, isolated US-stocks paper robot (own portfolio, own
 * USD currency, own cloud state file: state/stocks-state.json). Mirrors the
 * crypto side's Portfolio-value + History views (same chart, same trade
 * list), reading from `fetchStocksState()` instead of the crypto state.
 *
 * Runs only once ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY are configured as
 * GitHub Actions secrets — until then this shows "waiting for the robot".
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchStocksState } from '../cloudState';
import { mountEquityChartPanel } from '../equityChartPanel';
import { formatPrice, formatPct } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const dollar = (v: number): string => `$${formatPrice(v)}`;

export function renderStocksView(container: HTMLElement, _data: ActiveDataSource): ViewHandle {
  container.innerHTML = `
    <h2 class="view-title">Stocks</h2>
    <p class="view-sub">Separate simulated US-stocks robot — its own portfolio, in dollars.</p>
    <div id="stocks-chart"><div class="empty">Loading…</div></div>
    <h3>Markets</h3>
    <div class="markets-strip" id="stocks-markets"></div>
    <h3>Positions</h3>
    <div id="stocks-positions"></div>
    <h3>History</h3>
    <div class="stack" id="stocks-list"></div>`;

  const chartSlot = container.querySelector<HTMLElement>('#stocks-chart')!;
  const marketsEl = container.querySelector<HTMLElement>('#stocks-markets')!;
  const positionsEl = container.querySelector<HTMLElement>('#stocks-positions')!;
  const list = container.querySelector<HTMLElement>('#stocks-list')!;
  const chart = mountEquityChartPanel(chartSlot, { currencySymbol: '$' });
  let loadedOnce = false;

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    if (!state) {
      if (!loadedOnce) {
        chartSlot.innerHTML =
          '<div class="empty">Waiting for the stocks robot — set up ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY ' +
          'as GitHub Actions secrets to start it (see PROJECT_STATE.md).</div>';
      }
      return;
    }
    loadedOnce = true;
    chart.setHistory(state.equityHistory);

    if (state.marketSnapshot.length === 0) {
      marketsEl.innerHTML = '<div class="empty">Waiting for the robot’s next cycle (market hours only).</div>';
    } else {
      marketsEl.innerHTML = '';
      for (const s of state.marketSnapshot) {
        const up = s.changePct >= 0;
        const card = document.createElement('div');
        card.className = 'market-card';
        card.innerHTML = `
          <div class="market-top"><span class="market-name">${s.symbol}</span>
            <span class="chg ${up ? 'up' : 'down'}">${formatPct(s.changePct)}</span></div>
          <div class="market-price">${dollar(s.price)}</div>`;
        marketsEl.appendChild(card);
      }
    }

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

    if (state.history.length === 0) {
      list.innerHTML = '<div class="empty">No trades yet.</div>';
    } else {
      list.innerHTML = '';
      for (const t of state.history) {
        const buy = t.kind === 'buy';
        const row = document.createElement('div');
        row.className = `row trade ${t.kind}`;
        row.innerHTML = `
          <div class="row-main"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span>
            <div><div class="row-title">${t.symbol}</div>
              <div class="row-sub">${t.note ? t.note : buy ? 'opened' : 'closed'}</div></div></div>
          <div class="row-side"><span class="row-title">${dollar(t.price)}</span>
            <span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh</span>
            <span class="row-sub">${new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`;
        list.appendChild(row);
      }
    }
  }

  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), 60_000);

  return {
    pause: () => window.clearInterval(timer),
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), 60_000);
    },
  };
}
