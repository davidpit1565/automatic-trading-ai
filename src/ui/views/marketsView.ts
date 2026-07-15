/**
 * Markets — the biggest cryptos with live price, window change, and a
 * sparkline. Presentation only; data comes from the active source.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchTopMarkets, type MarketSnapshot } from '../markets';
import { sparklineSvg } from '../charts';
import { formatPrice, formatPct } from '../format';

const REFRESH_MS = 20_000;
const HOT = '#2fbf71';
const COLD = '#e4574f';

export function renderMarketsView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2 class="view-title">Markets</h2>
    <p class="view-sub">Live prices for the largest cryptocurrencies (EUR).</p>
    <div class="stack" id="markets-list"><div class="empty">Loading markets…</div></div>
    <p class="muted-line" id="markets-status"></p>`;
  const list = container.querySelector<HTMLElement>('#markets-list')!;
  const status = container.querySelector<HTMLElement>('#markets-status')!;

  function render(markets: MarketSnapshot[]): void {
    if (markets.length === 0) {
      list.innerHTML = '<div class="empty">Live market data is unavailable right now.</div>';
      return;
    }
    list.innerHTML = '';
    for (const m of markets) {
      const up = m.changePct >= 0;
      const row = document.createElement('div');
      row.className = 'market-row';
      row.innerHTML = `
        <div class="market-row-id"><span class="row-title">${m.label}</span>
          <span class="row-sub">${m.symbol}</span></div>
        <div class="market-row-spark" style="color:${up ? HOT : COLD}">${sparklineSvg(m.closes, { stroke: up ? HOT : COLD, fill: true, width: 130, height: 40 })}</div>
        <div class="market-row-num"><span class="row-title">€${formatPrice(m.price)}</span>
          <span class="chg ${up ? 'up' : 'down'}">${formatPct(m.changePct)}</span></div>`;
      list.appendChild(row);
    }
    status.textContent = `Live · updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ~48h change`;
  }

  async function load(): Promise<void> {
    render(await fetchTopMarkets(data, 6));
  }
  void load();
  window.setInterval(() => void load(), REFRESH_MS);
}
