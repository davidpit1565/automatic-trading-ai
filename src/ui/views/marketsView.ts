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
  fetchMarketRows,
  fetchSeries,
  fetchCandleSeries,
  type MarketRow,
  type CandleSeries,
  type PriceSeries,
} from '../markets';
import {
  priceChartSvg,
  candleChartSvg,
  chartGeometry,
  candleGeometry,
  type ChartGeometry,
} from '../charts';
import { startLivePrice } from '../liveTicker';
import { escapeHtml, formatClock, formatMarketPrice, formatPct, formatPrice, formatSignedPrice } from '../format';
import { attachCoinLogoFallback, coinLogoHtml } from '../coinLogo';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 20_000;
/**
 * The Markets LIST refreshes through KrakenPublicSource's serialized queue
 * (150ms stagger) — at 20s the requests stacked faster than they drained and
 * the detail chart (same queue) went sluggish. 60s lets each sweep finish.
 */
const LIST_REFRESH_MS = 60_000;
/**
 * FALLBACK cap only. The list normally comes from one batch-ticker request
 * covering every EUR market (535 in ~80ms, measured live), so no cap applies.
 * A source without a batch ticker degrades to the old per-symbol sweep, which
 * walks the serialized queue one request at a time — at ~200-700ms each, an
 * uncapped sweep would take minutes and reintroduce the freeze that queue was
 * built to fix. 60 coins clears well inside the 60s refresh cadence.
 */
const MARKETS_LIST_CAP = 60;
/** Rows added per scroll page — see `visibleCount` in the view. */
const PAGE_SIZE = 50;
/** A row is stale (amber clock) once its data is older than this. */
const STALE_AFTER_MS = 5 * 60_000;
const HOT = '#16c784';
const COLD = '#ea3943';
/** Vite's deploy base — GitHub Pages serves from /<repo>/, so logo URLs need it. */
const BASE_URL = import.meta.env.BASE_URL;

/**
 * Category tabs. Each is a pure view over the same single batch-ticker
 * response — switching is instant and costs no extra request, which is the
 * whole reason the batch endpoint was worth moving to.
 */
interface Category {
  readonly key: string;
  readonly label: string;
  readonly apply: (rows: readonly MarketRow[]) => MarketRow[];
}
/** Ignore microcaps when ranking movers — a 300% move on €40 of volume is noise. */
const MOVER_MIN_VOLUME = 25_000;
const CATEGORIES: Category[] = [
  { key: 'popular', label: 'Popular', apply: (rows) => rows.slice(0, 40) },
  { key: 'all', label: 'All', apply: (rows) => [...rows] },
  {
    key: 'gainers',
    label: 'Gainers',
    apply: (rows) =>
      rows
        .filter((r) => r.quoteVolume >= MOVER_MIN_VOLUME && r.changePct > 0)
        .sort((a, b) => b.changePct - a.changePct),
  },
  {
    key: 'losers',
    label: 'Losers',
    apply: (rows) =>
      rows
        .filter((r) => r.quoteVolume >= MOVER_MIN_VOLUME && r.changePct < 0)
        .sort((a, b) => a.changePct - b.changePct),
  },
  {
    key: 'volume',
    label: 'Volume',
    apply: (rows) => [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume),
  },
];

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
      <p class="view-sub">Every EUR market on Kraken, live. Tap a coin for its chart.</p>
      <div class="mk-tabs" id="mk-tabs" role="tablist">${CATEGORIES.map(
        (c, i) =>
          `<button class="mk-tab${i === 0 ? ' active' : ''}" role="tab" ` +
          `aria-selected="${i === 0}" data-cat="${c.key}">${c.label}</button>`,
      ).join('')}</div>
      <div class="stack" id="mk-list"><div class="empty">Loading markets…</div></div>
      <p class="muted-line" id="mk-status"></p>
    </div>
    <div id="mk-detail-view" hidden></div>`;

  const listView = container.querySelector<HTMLElement>('#mk-list-view')!;
  const detailView = container.querySelector<HTMLElement>('#mk-detail-view')!;
  const list = container.querySelector<HTMLElement>('#mk-list')!;
  const status = container.querySelector<HTMLElement>('#mk-status')!;

  let markets: MarketRow[] = [];
  /** The active category applied to `markets` — what the list actually shows. */
  let view: MarketRow[] = [];
  let category: Category = CATEGORIES[0]!;
  /**
   * Snapshot of `view` taken when a detail opens. The detail's prev/next pages
   * through THIS, not the live list: categories like Gainers reorder on every
   * refresh, and navigating a list that reshuffles underneath you sends "Next"
   * somewhere arbitrary.
   */
  let detailRows: MarketRow[] = [];
  /**
   * Rows currently in the DOM. The full EUR universe is ~535 markets; building
   * all of them up front is wasted work on a phone when only a handful are on
   * screen. Grows a page at a time as the user reaches the bottom, and is
   * preserved across the background refresh so the list never jumps under a
   * scrolling finger.
   */
  let visibleCount = PAGE_SIZE;
  let moreObserver: IntersectionObserver | null = null;
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

  /** One market row: logo + identity on the left, price and change on the right. */
  function rowHtml(m: MarketRow, index: number): string {
    const up = m.changePct >= 0;
    const stale = Date.now() - m.updatedAt > STALE_AFTER_MS;
    return (
      `<button class="market-row tappable" data-row="${index}">` +
      coinLogoHtml(m.base, BASE_URL) +
      `<span class="market-row-id">` +
      `<span class="row-title">${escapeHtml(m.label)}</span>` +
      `<span class="row-sub"><span class="row-clock ${stale ? 'stale' : 'fresh'}" aria-hidden="true"></span>` +
      `${formatClock(m.updatedAt)} · ${escapeHtml(m.symbol)}</span>` +
      `</span>` +
      `<span class="market-row-num">` +
      `<span class="row-price">€${formatMarketPrice(m.price)}</span>` +
      `<span class="chg ${up ? 'up' : 'down'}">${formatSignedPrice(m.change, m.price)} (${formatPct(m.changePct)})</span>` +
      `</span>` +
      `</button>`
    );
  }

  /** Observe the "load more" sentinel so the next page builds as it scrolls in. */
  function observeMore(): void {
    moreObserver?.disconnect();
    moreObserver = null;
    const sentinel = list.querySelector('#mk-more');
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    moreObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      visibleCount = Math.min(visibleCount + PAGE_SIZE, markets.length);
      renderList();
    }, { rootMargin: '400px' });
    moreObserver.observe(sentinel);
  }

  function renderList(): void {
    if (markets.length === 0) {
      list.innerHTML = '<div class="empty">Live market data is unavailable right now.</div>';
      return;
    }
    view = category.apply(markets);
    if (view.length === 0) {
      list.innerHTML = `<div class="empty">No markets in ${category.label} right now.</div>`;
      status.textContent = `Live · ${markets.length} markets · updated ${hm(Date.now())}`;
      return;
    }
    // Re-rendering the SAME number of rows keeps the list's height identical,
    // so the browser holds the scroll position across a background refresh.
    const shown = Math.min(visibleCount, view.length);
    const rows = view.slice(0, shown).map(rowHtml).join('');
    const more =
      shown < view.length
        ? `<div id="mk-more" class="market-more">Loading more markets… (${shown} of ${view.length})</div>`
        : `<div class="market-more muted-line">All ${view.length} markets shown</div>`;
    list.innerHTML = rows + more;
    observeMore();
    status.textContent =
      `Live · ${view.length} of ${markets.length} EUR markets · updated ${hm(Date.now())} · ` +
      `change since 00:00 UTC`;
  }

  let listLoading = false;
  async function loadList(): Promise<void> {
    if (listLoading) return; // never overlap sweeps — overlaps stack the queue
    listLoading = true;
    try {
      const fresh = await fetchMarketRows(data, MARKETS_LIST_CAP);
      if (fresh.length > 0) markets = fresh; // keep last good list on a bad sweep
      if (detailView.hidden) renderList();
    } finally {
      listLoading = false;
    }
  }

  function openDetail(index: number, opts: { preserveRange?: boolean } = {}): void {
    // Freeze the ordering the user was looking at, so prev/next stays coherent
    // even as a refresh reshuffles a category like Gainers underneath.
    if (!opts.preserveRange || detailRows.length === 0) detailRows = view.length > 0 ? [...view] : [...markets];
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
      const m = detailRows[coin]!;
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
          <span class="row-sub">${coin + 1} / ${detailRows.length}</span>
          <button class="pager" id="mk-next" ${coin === detailRows.length - 1 ? 'disabled' : ''}>Next ›</button>
        </div>`;

      detailView.querySelector('#mk-back')!.addEventListener('click', backToList);
      detailView.querySelector('#mk-prev')!.addEventListener('click', () => { if (coin > 0) { coin--; rangeKey = '1D'; savedRangeKey = rangeKey; void paint(); } });
      detailView.querySelector('#mk-next')!.addEventListener('click', () => { if (coin < detailRows.length - 1) { coin++; rangeKey = '1D'; savedRangeKey = rangeKey; void paint(); } });
      detailView.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const chart = detailView.querySelector<HTMLElement>('.detail-chart');
          if (chart) chart.classList.add('fade-out');
          setTimeout(() => {
            rangeKey = b.dataset['range']!;
            savedRangeKey = rangeKey;
            void paint();
            if (chart) {
              chart.classList.remove('fade-out');
              chart.classList.add('fade-in');
              setTimeout(() => chart.classList.remove('fade-in'), 300);
            }
          }, 200);
        });
      });
      detailView.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const chart = detailView.querySelector<HTMLElement>('.detail-chart');
          if (chart) chart.classList.add('fade-out');
          setTimeout(() => {
            const mode = b.dataset['mode'];
            if (mode === 'candle' || mode === 'line') { chartMode = mode; savedChartMode = mode; void paint(); }
            if (chart) {
              chart.classList.remove('fade-out');
              chart.classList.add('fade-in');
              setTimeout(() => chart.classList.remove('fade-in'), 300);
            }
          }, 200);
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

  // Delegated so 500+ rows cost one listener, not one each — and so rows
  // re-rendered by a refresh stay clickable without rebinding.
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row]');
    if (!row) return;
    const index = Number(row.dataset['row']);
    if (Number.isInteger(index) && index >= 0 && index < view.length) openDetail(index);
  });
  // One capture-phase listener covers every row's logo (error does not bubble).
  attachCoinLogoFallback(list);

  container.querySelector('#mk-tabs')!.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cat]');
    if (!tab) return;
    const picked = CATEGORIES.find((c) => c.key === tab.dataset['cat']);
    if (!picked || picked === category) return;
    category = picked;
    visibleCount = PAGE_SIZE; // a new category starts at the top
    for (const el of container.querySelectorAll<HTMLElement>('.mk-tab')) {
      const active = el.dataset['cat'] === picked.key;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    }
    renderList();
  });

  void loadList();
  listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);

  return {
    pause: () => {
      window.clearInterval(listTimer);
      window.clearInterval(detailTimer);
      moreObserver?.disconnect();
      moreObserver = null;
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
