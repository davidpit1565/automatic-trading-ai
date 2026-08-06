/**
 * Stocks Market sub-page: the curated stock universe's last-known prices,
 * from the `market-snapshot` field the stocks autopilot writes each cycle
 * (see `server/stocksRunner.mts`'s `updateMarketSnapshot`). No live pricing
 * of its own — read-only off the committed cloud state, same as the rest of
 * the Stocks section.
 */

import { fetchStocksState } from '../cloudState';
import { formatPrice, formatPct } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

export function renderStocksMarketPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `<div class="markets-strip" id="stocks-market-list"><div class="empty">Loading…</div></div>`;
  const list = container.querySelector<HTMLElement>('#stocks-market-list')!;
  let loadedOnce = false;

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    if (!state) {
      if (!loadedOnce) list.innerHTML = '<div class="empty">Market snapshot unavailable right now.</div>';
      return;
    }
    loadedOnce = true;
    if (state.marketSnapshot.length === 0) {
      list.innerHTML = '<div class="empty">Waiting for the robot’s next cycle (market hours only).</div>';
      return;
    }
    list.innerHTML = '';
    for (const s of [...state.marketSnapshot].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      const up = s.changePct >= 0;
      const card = document.createElement('div');
      card.className = 'market-card';
      card.innerHTML = `
        <div class="market-top"><span class="market-name">${s.symbol}</span>
          <span class="chg ${up ? 'up' : 'down'}">${formatPct(s.changePct)}</span></div>
        <div class="market-price">$${formatPrice(s.price)}</div>`;
      list.appendChild(card);
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
