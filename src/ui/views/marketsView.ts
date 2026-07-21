/**
 * Markets — browse the largest cryptos. The list shows live price, window
 * change and a sparkline; tap any coin (Bitcoin first) to open a detail view
 * with a real, interactive chart (value axis + time axis, crosshair + tooltip,
 * a live current-price marker), a timeframe selector (1D default → All time),
 * and prev/next browsing. Prices are in EUR.
 */

import type { ActiveDataSource } from '../dataSource';
import type { Timeframe } from '../../core/types';
import {
  fetchTopMarkets,
  fetchSeries,
  fetchCandleSeries,
  type MarketSnapshot,
  type CandleSeries,
  type PriceSeries,
} from '../markets';
import {
  sparklineSvg,
  priceChartSvg,
  candleChartSvg,
  chartGeometry,
  candleGeometry,
  type ChartGeometry,
} from '../charts';
import { startLivePrice } from '../liveTicker';
import { formatPrice, formatPct } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 20_000;
/**
 * The Markets LIST refreshes through KrakenPublicSource's serialized queue
 * (150ms stagger) — at 20s the requests stacked faster than they drained and
 * the detail chart (same queue) went sluggish. 60s lets each sweep finish.
 */
const LIST_REFRESH_MS = 60_000;
/**
 * `getInstruments()` now broadens well beyond the 10 curated majors (every
 * live EUR pair Kraken lists — 500+ as of 2026-07-20), but the list sweep
 * still walks the queue one request at a time. Measured real per-request
 * latency (~200-700ms) means an unbounded sweep of that many coins would
 * take minutes, not seconds — reintroducing the exact freeze this queue was
 * fixed for, just at a larger scale. Cap the auto-refreshed list at a size
 * the queue clears well within one refresh cycle (60 coins ≈ 60 × ~0.5s incl.
 * stagger ≈ 30s, comfortably under the 60s cadence below).
 */
const MARKETS_LIST_CAP = 60;
const HOT = '#16c784';
const COLD = '#ea3943';

interface Range {
  readonly key: string;
  readonly tf: Timeframe;
  readonly limit: number;
  readonly fx: (ts: number) => string;
  /** Long ranges render a smooth line/area (candles at 300+ bars are unreadable
   * on a phone). Short ranges keep the Candles/Line toggle. */
  readonly long?: boolean;
}
const RANGES: Range[] = [
  { key: '1D', tf: '15m', limit: 96, fx: (t) => hm(t) },
  { key: '1W', tf: '1h', limit: 168, fx: (t) => dm(t) },
  { key: '1M', tf: '4h', limit: 180, fx: (t) => dm(t) },
  { key: '1Y', tf: '1d', limit: 365, fx: (t) => mon(t), long: true },
  { key: '5Y', tf: '1w', limit: 260, fx: (t) => yr(t), long: true },
  { key: '10Y', tf: '1w', limit: 520, fx: (t) => yr(t), long: true },
  { key: 'All', tf: '1w', limit: 720, fx: (t) => yr(t), long: true },
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

export function renderMarketsView(container: HTMLElement, data: ActiveDataSource): ViewHandle {
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
  // Tracks which coin's detail is open (null = list view) so pause/resume can
  // restart whichever was showing, instead of always falling back to the list.
  let openCoinIndex: number | null = null;
  // Bumped by every openDetail()/backToList() call. A paint() in flight when
  // the user switches coins (or backs out) checks this before writing to the
  // shared detailView — without it, a slow fetch for a coin the user has
  // already left resolves later and silently overwrites whatever is now on
  // screen with the wrong coin's chart/price/live-ticker.
  let detailGeneration = 0;
  // The range/chart-mode the user last chose, so resume() (view pause while
  // a detail is open, then coming back) reopens on the same view instead of
  // silently resetting to 1D/Candle. A genuinely fresh tap from the list
  // still starts at the defaults, same as before.
  let savedRangeKey = '1D';
  let savedChartMode: 'candle' | 'line' = 'candle';

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

  let listLoading = false;
  async function loadList(): Promise<void> {
    if (listLoading) return; // never overlap sweeps — overlaps stack the queue
    listLoading = true;
    try {
      const fresh = await fetchTopMarkets(data, MARKETS_LIST_CAP);
      if (fresh.length > 0) markets = fresh; // keep last good list on a bad sweep
      if (detailView.hidden) renderList();
    } finally {
      listLoading = false;
    }
  }

  function openDetail(index: number, opts: { preserveRange?: boolean } = {}): void {
    openCoinIndex = index;
    detailGeneration++;
    const myGeneration = detailGeneration;
    window.clearInterval(listTimer);
    listView.hidden = true;
    detailView.hidden = false;
    let coin = index;
    // Candles by default; the choice persists across range/coin changes while
    // this detail stays open. `resume()` asks to preserve the last choice
    // instead (see `savedRangeKey`/`savedChartMode`); a fresh tap from the
    // list always starts at the defaults.
    let rangeKey = opts.preserveRange ? savedRangeKey : '1D';
    let chartMode: 'candle' | 'line' = opts.preserveRange ? savedChartMode : 'candle';
    savedRangeKey = rangeKey;
    savedChartMode = chartMode;
    // Monotonic paint id: only the newest paint renders. Prevents an overlap
    // between the 20s auto-refresh and a slow fetch from freezing the chart.
    let paintSeq = 0;
    // Per-open-detail series cache keyed by coin:range:mode. Switching ranges or
    // coins (and back) is INSTANT — no refetch. The 20s timer force-refreshes
    // only the currently open range, updating its cache entry.
    const seriesCache = new Map<string, CandleSeries | PriceSeries | null>();

    const paint = async (opts: { force?: boolean } = {}): Promise<void> => {
      const seq = ++paintSeq;
      stopLivePrice();
      try {
      const m = markets[coin]!;
      const range = RANGES.find((r) => r.key === rangeKey)!;
      // Long ranges force a smooth line; short ranges honour the toggle.
      const mode: 'candle' | 'line' = range.long ? 'line' : chartMode;
      const cacheKey = `${coin}:${rangeKey}:${mode}`;

      let chart: string;
      let price: number;
      let changePct: number;
      let wire: (() => void) | null = null;

      if (mode === 'candle') {
        let series = (!opts.force && seriesCache.has(cacheKey)
          ? seriesCache.get(cacheKey)
          : await fetchCandleSeries(data, m.symbol, range.tf, range.limit)) as CandleSeries | null;
        // Never cache a failure (it would stick as "No history"); on a failed
        // refresh keep showing the last good series.
        if (series) seriesCache.set(cacheKey, series);
        else if (seriesCache.has(cacheKey)) series = seriesCache.get(cacheKey) as CandleSeries;
        price = series?.price ?? m.price;
        changePct = series?.changePct ?? 0;
        chart = series
          ? candleChartSvg(series.candles, { formatX: range.fx, formatY: (v) => `€${formatPrice(v)}` })
          : '<div class="empty">No history for this range yet.</div>';
        if (series) {
          const candles = series.candles;
          const geo = candleGeometry(candles);
          wire = (): void =>
            wireChart({
              geo,
              symbol: m.symbol,
              range,
              firstValue: candles[0]!.close,
              valueAt: (idx) => candles[idx]!.close,
              tipHtml: (idx) => {
                const c = candles[idx]!;
                return (
                  `<span class="pchart-tip-price">€${formatPrice(c.close)}</span>` +
                  `<span class="pchart-tip-ohlc">O €${formatPrice(c.open)} · H €${formatPrice(c.high)} · L €${formatPrice(c.low)} · C €${formatPrice(c.close)}</span>` +
                  `<span class="pchart-tip-time">${tipStamp(c.timestamp, range.tf)}</span>`
                );
              },
            });
        }
      } else {
        let series = (!opts.force && seriesCache.has(cacheKey)
          ? seriesCache.get(cacheKey)
          : await fetchSeries(data, m.symbol, range.tf, range.limit)) as PriceSeries | null;
        // Same failure policy as candles: never cache null, keep last good.
        if (series) seriesCache.set(cacheKey, series);
        else if (seriesCache.has(cacheKey)) series = seriesCache.get(cacheKey) as PriceSeries;
        price = series?.price ?? m.price;
        changePct = series?.changePct ?? 0;
        const up = changePct >= 0;
        chart = series
          ? priceChartSvg(series.points, {
              stroke: up ? HOT : COLD,
              formatX: range.fx,
              formatY: (v) => `€${formatPrice(v)}`,
            })
          : '<div class="empty">No history for this range yet.</div>';
        if (series) {
          const points = series.points;
          const geo = chartGeometry(points);
          wire = (): void =>
            wireChart({
              geo,
              symbol: m.symbol,
              range,
              firstValue: points[0]!.value,
              valueAt: (idx) => points[idx]!.value,
              tipHtml: (idx) => {
                const pt = points[idx]!;
                return (
                  `<span class="pchart-tip-price">€${formatPrice(pt.value)}</span>` +
                  `<span class="pchart-tip-time">${tipStamp(pt.timestamp, range.tf)}</span>`
                );
              },
            });
        }
      }

      // A newer paint superseded this one (same detail), or a different coin's
      // detail (or the list) opened while this fetch was in flight — either
      // way, this response is stale and must not touch the shared detailView.
      if (seq !== paintSeq || myGeneration !== detailGeneration) return;
      const up = changePct >= 0;
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
        <div class="chart-controls">
          <div class="range-bar">${rangeBar}</div>
          <div class="chart-toggle">
            <button class="ctoggle-btn ${mode === 'candle' ? 'active' : ''}" data-mode="candle" ${range.long ? 'disabled' : ''}>Candles</button>
            <button class="ctoggle-btn ${mode === 'line' ? 'active' : ''}" data-mode="line" ${range.long ? 'disabled' : ''}>Line</button>
          </div>
        </div>
        <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>
        <div class="detail-nav">
          <button class="pager" id="mk-prev" ${coin === 0 ? 'disabled' : ''}>‹ Prev</button>
          <span class="row-sub">${coin + 1} / ${markets.length}</span>
          <button class="pager" id="mk-next" ${coin === markets.length - 1 ? 'disabled' : ''}>Next ›</button>
        </div>`;

      detailView.querySelector('#mk-back')!.addEventListener('click', backToList);
      detailView.querySelector('#mk-prev')!.addEventListener('click', () => { if (coin > 0) { coin--; rangeKey = '1D'; savedRangeKey = rangeKey; void paint(); } });
      detailView.querySelector('#mk-next')!.addEventListener('click', () => { if (coin < markets.length - 1) { coin++; rangeKey = '1D'; savedRangeKey = rangeKey; void paint(); } });
      detailView.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
        b.addEventListener('click', () => { rangeKey = b.dataset['range']!; savedRangeKey = rangeKey; void paint(); });
      });
      detailView.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const mode = b.dataset['mode'];
          if (mode === 'candle' || mode === 'line') { chartMode = mode; savedChartMode = mode; void paint(); }
        });
      });

      if (wire) wire();
      } catch {
        // Never leave a frozen/broken chart. Keep the last good render; the
        // periodic refresh retries. If nothing has rendered yet, show a note.
        if (myGeneration === detailGeneration && seq === paintSeq && !detailView.querySelector('svg.pchart')) {
          detailView.innerHTML =
            '<button class="tool-back" id="mk-eb">← All markets</button>' +
            '<div class="empty">Chart unavailable — retrying…</div>';
          detailView.querySelector('#mk-eb')?.addEventListener('click', backToList);
        }
      }
    };

    /**
     * Crosshair + tooltip interaction and the live current-price marker, shared
     * by line and candle modes. The caller supplies a `geo` (from
     * `chartGeometry` for closes, or `candleGeometry` for candles — both use the
     * same viewBox/padding), a value accessor for the crosshair dot, and the
     * tooltip markup for the hovered index. This is why the crosshair and the
     * live marker keep working unchanged with candles: the pointer→viewBox
     * mapping and `geo.y(price)` marker math are identical, only the data the
     * geometry is built from (and the tooltip contents) differ.
     */
    const wireChart = (cfg: {
      geo: ChartGeometry;
      symbol: string;
      range: Range;
      firstValue: number;
      valueAt: (idx: number) => number;
      tipHtml: (idx: number) => string;
    }): void => {
      const svg = detailView.querySelector<SVGSVGElement>('svg.pchart');
      const tip = detailView.querySelector<HTMLElement>('.pchart-tip');
      if (!svg || !tip) return;
      const geo = cfg.geo;
      const cross = svg.querySelector<SVGElement>('.pchart-cross');
      const crossLine = svg.querySelector<SVGLineElement>('.pchart-cross-line');
      const crossDot = svg.querySelector<SVGCircleElement>('.pchart-cross-dot');

      const showAt = (clientX: number): void => {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0) return;
        const idx = geo.indexAtFraction((clientX - rect.left) / rect.width);
        const px = geo.x(idx);
        const py = geo.y(cfg.valueAt(idx));
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
        tip.innerHTML = cfg.tipHtml(idx);
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
      const first = cfg.firstValue;
      stopLive = startLivePrice(data, cfg.symbol, (tick) => {
        const price = tick.price;
        const priceEl = detailView.querySelector<HTMLElement>('#mk-price');
        if (priceEl) priceEl.textContent = `€${formatPrice(price)}`;
        const chg = first > 0 ? ((price - first) / first) * 100 : 0;
        const chgEl = detailView.querySelector<HTMLElement>('#mk-change');
        if (chgEl) {
          chgEl.className = `chg ${chg >= 0 ? 'up' : 'down'}`;
          chgEl.textContent = `${formatPct(chg)} · ${cfg.range.key}`;
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
    detailTimer = window.setInterval(() => {
      // Don't wipe the chart mid-touch: while the crosshair tooltip is open the
      // user is inspecting — skip this tick; the next one repaints after they
      // let go. The live price marker keeps updating independently meanwhile.
      const tip = detailView.querySelector<HTMLElement>('.pchart-tip');
      if (tip && !tip.hidden) return;
      void paint({ force: true });
    }, REFRESH_MS);
  }

  function backToList(): void {
    openCoinIndex = null;
    detailGeneration++; // invalidates any still-in-flight paint for the coin we're leaving
    window.clearInterval(detailTimer);
    stopLivePrice();
    detailView.hidden = true;
    listView.hidden = false;
    renderList();
    listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);
  }

  void loadList();
  listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);

  return {
    pause: () => {
      window.clearInterval(listTimer);
      window.clearInterval(detailTimer);
      stopLivePrice();
    },
    resume: () => {
      if (openCoinIndex !== null) {
        openDetail(openCoinIndex, { preserveRange: true });
      } else {
        void loadList();
        listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);
      }
    },
  };
}
