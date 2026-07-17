/**
 * Markets — browse the largest cryptos. The list shows live price, window
 * change and a sparkline; tap any coin (Bitcoin first) to open a detail view
 * with a real, interactive chart (value axis + time axis, crosshair + tooltip,
 * a live current-price marker), a timeframe selector (1D default → All time),
 * and prev/next browsing. Prices are in EUR.
 */

import type { ActiveDataSource } from '../dataSource';
import type { Timeframe } from '../../core/types';
import { fetchTopMarkets, fetchSeries, type MarketSnapshot } from '../markets';
import { sparklineSvg, priceChartSvg, chartGeometry } from '../charts';
import { startLivePrice } from '../liveTicker';
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
const INTRADAY: ReadonlySet<Timeframe> = new Set<Timeframe>(['1m', '5m', '15m', '30m', '1h', '4h']);
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short' });
const yr = (t: number): string => String(new Date(t).getFullYear());

/** Full stamp for the crosshair tooltip (adds time on intraday ranges). */
function tipStamp(ts: number, tf: Timeframe): string {
  const d = new Date(ts);
  return INTRADAY.has(tf)
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

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
  let stopLive: (() => void) | null = null;

  const stopLivePrice = (): void => {
    if (stopLive) {
      stopLive();
      stopLive = null;
    }
  };

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
      stopLivePrice();
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
          <div class="detail-price"><div class="row-title big" id="mk-price">€${formatPrice(price)}</div>
            <div class="chg ${up ? 'up' : 'down'}" id="mk-change">${formatPct(changePct)} · ${rangeKey}</div></div>
        </div>
        <div class="range-bar">${rangeBar}</div>
        <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>
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

      if (series) wireChart(series.points, range, m.symbol);
    };

    /** Crosshair + tooltip interaction and the live current-price marker. */
    const wireChart = (
      points: { timestamp: number; value: number }[],
      range: Range,
      symbol: string,
    ): void => {
      const svg = detailView.querySelector<SVGSVGElement>('svg.pchart');
      const tip = detailView.querySelector<HTMLElement>('.pchart-tip');
      if (!svg || !tip) return;
      const geo = chartGeometry(points);
      const cross = svg.querySelector<SVGElement>('.pchart-cross');
      const crossLine = svg.querySelector<SVGLineElement>('.pchart-cross-line');
      const crossDot = svg.querySelector<SVGCircleElement>('.pchart-cross-dot');

      const showAt = (clientX: number): void => {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0) return;
        const idx = geo.indexAtFraction((clientX - rect.left) / rect.width);
        const pt = points[idx]!;
        const px = geo.x(idx);
        const py = geo.y(pt.value);
        if (crossLine) {
          crossLine.setAttribute('x1', px.toFixed(1));
          crossLine.setAttribute('x2', px.toFixed(1));
        }
        if (crossDot) {
          crossDot.setAttribute('cx', px.toFixed(1));
          crossDot.setAttribute('cy', py.toFixed(1));
        }
        cross?.classList.add('show');
        tip.hidden = false;
        tip.innerHTML =
          `<span class="pchart-tip-price">€${formatPrice(pt.value)}</span>` +
          `<span class="pchart-tip-time">${tipStamp(pt.timestamp, range.tf)}</span>`;
        // The CSS aspect-ratio matches the viewBox, so viewBox→% is linear.
        tip.style.left = `${(px / geo.W) * 100}%`;
        tip.style.top = `${(py / geo.H) * 100}%`;
      };
      const hide = (): void => {
        cross?.classList.remove('show');
        tip.hidden = true;
      };
      svg.addEventListener('pointermove', (e) => showAt(e.clientX));
      svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
      svg.addEventListener('pointerleave', hide);
      svg.addEventListener('pointercancel', hide);

      // Live current-price marker: move the right-edge dot/line/pill and the
      // headline as fresh prices arrive — no full re-render, so no flicker.
      const first = points[0]!.value;
      stopLive = startLivePrice(data, symbol, (tick) => {
        const price = tick.price;
        const priceEl = detailView.querySelector<HTMLElement>('#mk-price');
        if (priceEl) priceEl.textContent = `€${formatPrice(price)}`;
        const chg = first > 0 ? ((price - first) / first) * 100 : 0;
        const chgEl = detailView.querySelector<HTMLElement>('#mk-change');
        if (chgEl) {
          chgEl.className = `chg ${chg >= 0 ? 'up' : 'down'}`;
          chgEl.textContent = `${formatPct(chg)} · ${range.key}`;
        }
        const y = Math.max(geo.padT, Math.min(geo.H - geo.padB, geo.y(price)));
        const dot = svg.querySelector<SVGCircleElement>('.pchart-now');
        const line = svg.querySelector<SVGLineElement>('.pchart-now-line');
        const tag = svg.querySelector<SVGGElement>('.pchart-now-tag');
        const text = svg.querySelector<SVGTextElement>('.pchart-now-text');
        dot?.setAttribute('cy', y.toFixed(1));
        line?.setAttribute('y1', y.toFixed(1));
        line?.setAttribute('y2', y.toFixed(1));
        tag?.setAttribute('transform', `translate(${(geo.W - geo.padR + 1).toFixed(1)}, ${y.toFixed(1)})`);
        if (text) text.textContent = `€${formatPrice(price)}`;
      });
    };

    void paint();
    window.clearInterval(detailTimer);
    detailTimer = window.setInterval(() => void paint(), REFRESH_MS);
  }

  function backToList(): void {
    window.clearInterval(detailTimer);
    stopLivePrice();
    detailView.hidden = true;
    listView.hidden = false;
    renderList();
    listTimer = window.setInterval(() => void loadList(), REFRESH_MS);
  }

  void loadList();
  listTimer = window.setInterval(() => void loadList(), REFRESH_MS);
}
