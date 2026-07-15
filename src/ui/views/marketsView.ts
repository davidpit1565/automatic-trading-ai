/**
 * Markets — browse the largest cryptos. The list shows live price, window
 * change and a sparkline; tap any coin (Bitcoin first) to open a detail view
 * with a larger live chart and prev/next browsing. Presentation only.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchTopMarkets, fetchSnapshot, type MarketSnapshot } from '../markets';
import { sparklineSvg } from '../charts';
import { formatPrice, formatPct } from '../format';

const REFRESH_MS = 20_000;
const HOT = '#16c784';
const COLD = '#ea3943';

export function renderMarketsView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <div id="mk-list-view">
      <h2 class="view-title">Markets</h2>
      <p class="view-sub">Live prices for the largest cryptocurrencies. Tap a coin for its chart.</p>
      <div class="stack" id="mk-list"><div class="empty">Loading markets…</div></div>
      <p class="muted-line" id="mk-status"></p>
    </div>
    <div id="mk-detail-view" hidden></div>`;

  const listView = container.querySelector<HTMLElement>('#mk-list-view')!;
  const detailView = container.querySelector<HTMLElement>('#mk-detail-view')!;
  const list = container.querySelector<HTMLElement>('#mk-list')!;
  const status = container.querySelector<HTMLElement>('#mk-status')!;

  let markets: MarketSnapshot[] = [];
  let listTimer = 0;
  let detailTimer = 0;

  function renderList(): void {
    if (markets.length === 0) {
      list.innerHTML = '<div class="empty">Live market data is unavailable right now.</div>';
      return;
    }
    list.innerHTML = '';
    markets.forEach((m, index) => {
      const up = m.changePct >= 0;
      const row = document.createElement('button');
      row.className = 'market-row tappable';
      row.innerHTML = `
        <div class="market-row-id"><span class="row-title">${m.label}</span><span class="row-sub">${m.symbol}</span></div>
        <div class="market-row-spark" style="color:${up ? HOT : COLD}">${sparklineSvg(m.closes, { stroke: up ? HOT : COLD, fill: true, width: 130, height: 40 })}</div>
        <div class="market-row-num"><span class="row-title">€${formatPrice(m.price)}</span><span class="chg ${up ? 'up' : 'down'}">${formatPct(m.changePct)}</span></div>`;
      row.addEventListener('click', () => openDetail(index));
      list.appendChild(row);
    });
    status.textContent = `Live · updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ~48h change`;
  }

  async function loadList(): Promise<void> {
    markets = await fetchTopMarkets(data, 8);
    if (detailView.hidden) renderList();
  }

  function openDetail(index: number): void {
    window.clearInterval(listTimer);
    listView.hidden = true;
    detailView.hidden = false;
    let i = index;

    const paint = async (): Promise<void> => {
      const base = markets[i]!;
      const snap = (await fetchSnapshot(data, base.symbol, base.label, 120)) ?? base;
      const up = snap.changePct >= 0;
      detailView.innerHTML = `
        <button class="tool-back" id="mk-back">← All markets</button>
        <div class="detail-head">
          <div><div class="detail-name">${snap.label}</div><div class="row-sub">${snap.symbol} · last ~5 days</div></div>
          <div class="detail-price"><div class="row-title big">€${formatPrice(snap.price)}</div>
            <div class="chg ${up ? 'up' : 'down'}">${formatPct(snap.changePct)}</div></div>
        </div>
        <div class="detail-chart" style="color:${up ? HOT : COLD}">${sparklineSvg(snap.closes, { stroke: up ? HOT : COLD, fill: true, width: 340, height: 200 })}</div>
        <div class="detail-nav">
          <button class="pager" id="mk-prev" ${i === 0 ? 'disabled' : ''}>‹ Prev</button>
          <span class="row-sub">${i + 1} / ${markets.length}</span>
          <button class="pager" id="mk-next" ${i === markets.length - 1 ? 'disabled' : ''}>Next ›</button>
        </div>`;
      detailView.querySelector('#mk-back')!.addEventListener('click', backToList);
      detailView.querySelector('#mk-prev')!.addEventListener('click', () => { if (i > 0) { i--; void paint(); } });
      detailView.querySelector('#mk-next')!.addEventListener('click', () => { if (i < markets.length - 1) { i++; void paint(); } });
    };

    void paint();
    window.clearInterval(detailTimer);
    detailTimer = window.setInterval(() => void paint(), REFRESH_MS);
  }

  function backToList(): void {
    window.clearInterval(detailTimer);
    detailView.hidden = true;
    listView.hidden = false;
    renderList();
    listTimer = window.setInterval(() => void loadList(), REFRESH_MS);
  }

  void loadList();
  listTimer = window.setInterval(() => void loadList(), REFRESH_MS);
}
