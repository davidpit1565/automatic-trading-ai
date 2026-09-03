/**
 * Shared equity/P&L chart panel: range selector (1D → All), a smooth Line
 * chart (default) with a Candlestick toggle, an interactive crosshair +
 * tooltip, and a hero summary (current value + the gain/loss over the
 * selected range). Used by both the Portfolio value view and the History
 * view so one implementation — and one set of fixes — covers both.
 *
 * Line is the default (David flagged this, 2026-09-03: a real ~€8 balance
 * wobble read as an alarming "very big drop" once OHLC-bucketed into a
 * candle body) — every real trading app (Revolut X included) charts
 * account/portfolio VALUE as a smooth line, reserving candlesticks for a
 * tradable asset's own PRICE chart (Markets/coin-detail, a different
 * component entirely — unaffected by this default).
 */

import { priceChartSvg, candleChartSvg, chartGeometry, candleGeometry, positionChartTip, type ChartGeometry } from './charts';
import { formatPrice, formatPct } from './format';
import type { Candle } from '../core/types';

const HOT = 'var(--hot)';
const COLD = 'var(--cold)';
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Range {
  readonly key: string;
  readonly ms: number; // 0 = all
  /** Widest sensible candle bucket for this range, once there's enough
   * history to fill it (e.g. 1Y → weekly candles once a year has elapsed). */
  readonly bucketMs: number;
  readonly fx: (ts: number) => string;
}
const RANGES: Range[] = [
  { key: '1D', ms: DAY, bucketMs: HOUR, fx: (t) => hm(t) },
  { key: '1W', ms: 7 * DAY, bucketMs: 4 * HOUR, fx: (t) => dm(t) },
  { key: '1M', ms: 30 * DAY, bucketMs: DAY, fx: (t) => dm(t) },
  { key: '1Y', ms: 365 * DAY, bucketMs: 7 * DAY, fx: (t) => mon(t) },
  { key: 'All', ms: 0, bucketMs: 7 * DAY, fx: (t) => dm(t) },
];
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

/** Aim for roughly this many candles — readable on a phone, but enough to
 * show real structure even when a range's nominal bucket is far too wide
 * for how much history actually exists yet (e.g. 'All'/'1Y' on day 5 of
 * tracking, where a weekly bucket would flatten everything into 1-2 candles). */
const TARGET_CANDLES = 30;
/** Never bucket finer than this — avoids near-one-sample-per-candle noise
 * when there's very little history. Roughly the cloud agent's recording
 * cadence, so this floor rarely binds once tracking has run a while. */
const MIN_BUCKET_MS = 5 * 60_000;

/**
 * Shrink `niceBucketMs` down toward the actual data span when there isn't
 * enough history to fill it yet, so every range shows real structure
 * instead of 1-2 giant candles. Once `spanMs` comfortably exceeds
 * `niceBucketMs * TARGET_CANDLES`, this returns `niceBucketMs` unchanged.
 */
export function adaptiveBucketMs(spanMs: number, niceBucketMs: number): number {
  if (spanMs <= 0) return niceBucketMs;
  return Math.max(MIN_BUCKET_MS, Math.min(niceBucketMs, spanMs / TARGET_CANDLES));
}

/**
 * Bucket the raw equity samples (recorded every cloud cycle, ~5 min) into
 * real OHLC candles — open/close are the first/last sample in the bucket,
 * high/low the extremes seen. This is a genuine aggregation of recorded
 * data, not invented prices.
 */
export function bucketize(points: readonly { at: number; equity: number }[], bucketMs: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of points) {
    const bucketStart = Math.floor(p.at / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        timestamp: bucketStart, open: p.equity, high: p.equity, low: p.equity, close: p.equity, volume: 0,
      });
    } else {
      buckets.set(bucketStart, {
        ...existing,
        high: Math.max(existing.high, p.equity),
        low: Math.min(existing.low, p.equity),
        close: p.equity, // points are chronological, so the last write is the close
      });
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export interface EquityPoint {
  readonly at: number;
  readonly equity: number;
}

export interface EquityChartPanelHandle {
  /** Repaint with fresh data. Safe to call repeatedly (e.g. on each poll). */
  setHistory(history: readonly EquityPoint[]): void;
}

/**
 * Renders the range bar, candle/line toggle, chart and crosshair into
 * `container` (which the caller owns and clears itself). Call `setHistory`
 * once data first arrives and again on every refresh.
 */
export function mountEquityChartPanel(
  container: HTMLElement,
  options: { readonly currencySymbol?: string; readonly live?: boolean } = {},
): EquityChartPanelHandle {
  const currency = options.currencySymbol ?? '€';
  const tag = options.live ? '<span class="tag-live">REAL</span>' : '<span class="tag-sim">SIMULATED</span>';
  let history: readonly EquityPoint[] = [];
  let rangeKey = 'All';
  let chartMode: 'candle' | 'line' = 'line';

  function windowedPoints(): EquityPoint[] {
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const now = history[history.length - 1]!.at;
    let pts = range.ms > 0 ? history.filter((p) => p.at >= now - range.ms) : history.slice();
    if (pts.length < 2) pts = history.slice(); // fall back to All when the window is too short
    return pts;
  }

  /** Range/mode switches used to hard-snap with no transition at all — the
   * coin-detail market chart already fades out/in on the same kind of
   * switch (`marketsView.ts`), so this repaints the same way for
   * consistency: fade the current chart out, repaint, fade the new one in. */
  function repaintWithFade(): void {
    const chart = container.querySelector<HTMLElement>('.detail-chart');
    chart?.classList.add('fade-out');
    setTimeout(() => {
      paint();
      // `paint()` replaces the container's innerHTML, detaching `chart`
      // above — re-query the freshly-rendered node before fading it in.
      const freshChart = container.querySelector<HTMLElement>('.detail-chart');
      if (freshChart) {
        freshChart.classList.add('fade-in');
        setTimeout(() => freshChart.classList.remove('fade-in'), 300);
      }
    }, 200);
  }

  function paint(): void {
    if (history.length < 2) {
      container.innerHTML =
        '<div class="empty">Collecting data — the chart appears after a few cloud runs. Check back soon.</div>';
      return;
    }
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const pts = windowedPoints();
    const first = pts[0]!.equity;
    const last = pts[pts.length - 1]!.equity;
    const ret = first > 0 ? ((last - first) / first) * 100 : 0;
    const up = ret >= 0;
    const spanMs = pts[pts.length - 1]!.at - pts[0]!.at;
    const candles = bucketize(pts, adaptiveBucketMs(spanMs, range.bucketMs));
    const mode: 'candle' | 'line' = candles.length >= 2 ? chartMode : 'line';

    let chart: string;
    let geo: ChartGeometry | null = null;
    if (mode === 'candle') {
      // No EMA/support-resistance/volume overlays here — those are
      // technical-analysis signals for a tradable asset's price, and this
      // is the viewer's own portfolio equity, not a market to read a trend
      // signal off of (see the `indicators` option's own doc comment).
      chart = candleChartSvg(candles, { formatX: range.fx, formatY: (v) => `${currency}${formatPrice(v)}`, indicators: false });
      geo = candleGeometry(candles);
    } else {
      const points = pts.map((p) => ({ timestamp: p.at, value: p.equity }));
      chart = priceChartSvg(points, { stroke: up ? HOT : COLD, formatX: range.fx, formatY: (v) => `${currency}${formatPrice(v)}` });
      geo = chartGeometry(points);
    }
    const rangeBar = RANGES.map(
      (r) => `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}">${r.key}</button>`,
    ).join('');

    container.innerHTML = `
      <!-- hero-bare matches Home's balance treatment: same dominant-figure
           pattern for this sub-screen (shared by Crypto's and Stocks' History
           tab), not a secondary boxed widget. -->
      <div class="hero hero-bare">
        <div class="hero-label">Now ${tag}</div>
        <div class="hero-value">${currency}${formatPrice(last)}</div>
        <div class="hero-change ${up ? 'up' : 'down'}">${formatPct(ret)} · ${rangeKey}</div>
        <div class="hero-split"><span>since ${new Date(pts[0]!.at).toLocaleDateString('en-GB')}</span></div>
      </div>
      <div class="chart-controls">
        <div class="range-bar">${rangeBar}</div>
        <div class="chart-toggle">
          <button class="ctoggle-btn ${mode === 'line' ? 'active' : ''}" data-mode="line">Line</button>
          <button class="ctoggle-btn ${mode === 'candle' ? 'active' : ''}" data-mode="candle">Candles</button>
        </div>
      </div>
      <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>`;

    container.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
      b.addEventListener('click', () => { rangeKey = b.dataset['range']!; repaintWithFade(); });
    });
    container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const m = b.dataset['mode'];
        if (m === 'candle' || m === 'line') { chartMode = m; repaintWithFade(); }
      });
    });
    wireCrosshair(geo, mode, candles, range);
  }

  /** Crosshair + tooltip, shared by candle (OHLC) and line (price) modes. */
  function wireCrosshair(geo: ChartGeometry, mode: 'candle' | 'line', candles: Candle[], range: Range): void {
    const svg = container.querySelector<SVGSVGElement>('svg.pchart');
    const tip = container.querySelector<HTMLElement>('.pchart-tip');
    if (!svg || !tip) return;
    const cross = svg.querySelector<SVGElement>('.pchart-cross');
    const crossLine = svg.querySelector<SVGLineElement>('.pchart-cross-line');
    const crossDot = svg.querySelector<SVGCircleElement>('.pchart-cross-dot');

    const showAt = (clientX: number): void => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const idx = geo.indexAtFraction((clientX - rect.left) / rect.width);
      const c = candles[idx]!;
      const px = geo.x(idx);
      const py = geo.y(c.close);
      crossLine?.setAttribute('x1', px.toFixed(1));
      crossLine?.setAttribute('x2', px.toFixed(1));
      crossDot?.setAttribute('cx', px.toFixed(1));
      crossDot?.setAttribute('cy', py.toFixed(1));
      cross?.classList.add('show');
      tip.hidden = false;
      const stamp = new Date(c.timestamp).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      tip.innerHTML =
        mode === 'candle'
          ? `<span class="pchart-tip-price">${currency}${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-ohlc">O ${currency}${formatPrice(c.open)} · H ${currency}${formatPrice(c.high)} · L ${currency}${formatPrice(c.low)} · C ${currency}${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-time">${stamp}</span>`
          : `<span class="pchart-tip-price">${currency}${formatPrice(c.close)}</span><span class="pchart-tip-time">${stamp}</span>`;
      const wrap = container.querySelector<HTMLElement>('.pchart-wrap');
      if (wrap) positionChartTip(tip, wrap, px / geo.W, py / geo.H);
    };
    const hide = (): void => { cross?.classList.remove('show'); tip.hidden = true; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
    void range;
  }

  return {
    setHistory(h: readonly EquityPoint[]): void {
      history = h;
      paint();
    },
  };
}
