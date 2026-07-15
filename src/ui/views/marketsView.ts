/**
 * Markets — browse the largest cryptos. The list shows live price, window
 * change and a sparkline; tap any coin (Bitcoin first) to open a detail view
 * with a real chart (value axis + time axis), a timeframe selector
 * (1D default → All time), and prev/next browsing. Prices are in EUR.
 */

import type { ActiveDataSource } from '../dataSource';
import type { Timeframe } from '../../core/types';
import { fetchTopMarkets, fetchSeries, type MarketSnapshot } from '../markets';
import { sparklineSvg, priceChartSvg } from '../charts';
import { formatPrice, formatPct } from '../format';

const REFRESH_MS = 20_000;
const HOT = '#16c784';
const COLD = '#ea3943';

interface Range {
  readonly key: string;
  readonly tf: Timeframe;
  readonly limit: number;
  readonly fx: (ts: number) => string;
}
const RANGES: Range[] = [
  { key: '1D', tf: '15m', limit: 96, fx: (t) => hm(t) },
  { key: '1W', tf: '1h', limit: 168, fx: (t) => dm(t) },
  { key: '1M', tf: '4h', limit: 180, fx: (t) => dm(t) },
  { key: '1Y', tf: '1d', limit: 365, fx: (t) => mon(t) },
  { key: '5Y', tf: '1w', limit: 260, fx: (t) => yr(t) },
  { key: '10Y', tf: '1w', limit: 520, fx: (t) => yr(t) },
  { key: 'All', tf: '1w', limit: 720, fx: (t) => yr(t) },
];
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short' });
const yr = (t: number): string => String(new Date(t).getFullYear());

export function renderMarketsView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <div id="mk-list-view">
      <h2 class="view-title">Markets</h2>
      <p class="view-sub">Largest cryptocurrencies, live. Prices in EUR (€). Tap a coin for its chart.</p>
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
    status.textContent = `Live · updated ${hm(Date.now())} · ~48h change`;
  }

  async function loadList(): Promise<void> {
    markets = await fetchTopMarkets(data, 8);
    if (detailView.hidden) renderList();
  }

  function openDetail(index: number): void {
    window.clearInterval(listTimer);
    listView.hidden = true;
    detailView.hidden = false;
    let coin = index;
    let rangeKey = '1D';

    const paint = async (): Promise<void> => {
      const m = markets[coin]!;
      const range = RANGES.find((r) => r.key === rangeKey)!;
      const series = await fetchSeries(data, m.symbol, range.tf, range.limit);
      const price = series?.price ?? m.price;
      const changePct = series?.changePct ?? 0;
      const up = changePct >= 0;
      const chart = series
        ? priceChartSvg(series.points, {
            stroke: up ? HOT : COLD,
            formatX: range.fx,
            formatY: (v) => `€${formatPrice(v)}`,
          })
        : '<div class="empty">No history for this range yet.</div>';
      const rangeBar = RANGES.map(
        (r) => `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}">${r.key}</button>`,
      ).join('');

      detailView.innerHTML = `
        <button class="tool-back" id="mk-back">← All markets</button>
        <div class="detail-head">
          <div><div class="detail-name">${m.label}</div><div class="row-sub">${m.symbol} · EUR</div></div>
          <div class="detail-price"><div class="row-title big">€${formatPrice(price)}</div>
            <div class="chg ${up ? 'up' : 'down'}">${formatPct(changePct)} · ${rangeKey}</div></div>
        </div>
        <div class="range-bar">${rangeBar}</div>
        <div class="detail-chart">${chart}</div>
        <div class="detail-nav">
          <button class="pager" id="mk-prev" ${coin === 0 ? 'disabled' : ''}>‹ Prev</button>
          <span class="row-sub">${coin + 1} / ${markets.length}</span>
          <button class="pager" id="mk-next" ${coin === markets.length - 1 ? 'disabled' : ''}>Next ›</button>
        </div>`;

      detailView.querySelector('#mk-back')!.addEventListener('click', backToList);
      detailView.querySelector('#mk-prev')!.addEventListener('click', () => { if (coin > 0) { coin--; rangeKey = '1D'; void paint(); } });
      detailView.querySelector('#mk-next')!.addEventListener('click', () => { if (coin < markets.length - 1) { coin++; rangeKey = '1D'; void paint(); } });
      detailView.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
        b.addEventListener('click', () => { rangeKey = b.dataset['range']!; void paint(); });
      });
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
