/**
 * Portfolio value history — opened by tapping the value card on Home.
 * Charts the simulated portfolio value over time with a timeframe selector
 * (1D → All), candlesticks by default (bucketed from the real recorded
 * equity samples — open/high/low/close per bucket, not fabricated) with a
 * Line toggle, an interactive crosshair + tooltip, and the gain/loss since
 * tracking began. Read-only; data recorded by the cloud robot each cycle.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { priceChartSvg, candleChartSvg, chartGeometry, candleGeometry, type ChartGeometry } from '../charts';
import { formatPrice, formatPct } from '../format';
import type { Candle } from '../../core/types';
import type { ViewHandle } from '../viewLifecycle';

const HOT = '#16c784';
const COLD = '#ea3943';
const REFRESH_MS = 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Range {
  readonly key: string;
  readonly ms: number; // 0 = all
  /** Width of each candle bucket for this range. */
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

/**
 * Bucket the raw equity samples (recorded every cloud cycle, ~5 min) into
 * real OHLC candles — open/close are the first/last sample in the bucket,
 * high/low the extremes seen. This is a genuine aggregation of recorded
 * data, not invented prices.
 */
function bucketize(points: readonly { at: number; equity: number }[], bucketMs: number): Candle[] {
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

export function renderValueView(container: HTMLElement, _data: ActiveDataSource): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="home">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <div id="pv-body"><div class="empty">Loading…</div></div>`;
  const body = container.querySelector<HTMLElement>('#pv-body')!;

  let history: { at: number; equity: number }[] = [];
  let rangeKey = 'All';
  let chartMode: 'candle' | 'line' = 'candle';

  function windowedPoints(): { at: number; equity: number }[] {
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const now = history[history.length - 1]!.at;
    let pts = range.ms > 0 ? history.filter((p) => p.at >= now - range.ms) : history.slice();
    if (pts.length < 2) pts = history.slice(); // fall back to All when the window is too short
    return pts;
  }

  function paint(): void {
    if (history.length < 2) {
      body.innerHTML =
        '<div class="empty">Collecting data — the value chart appears after a few cloud runs. Check back soon.</div>';
      return;
    }
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const pts = windowedPoints();
    const first = pts[0]!.equity;
    const last = pts[pts.length - 1]!.equity;
    const ret = first > 0 ? ((last - first) / first) * 100 : 0;
    const up = ret >= 0;
    const candles = bucketize(pts, range.bucketMs);
    const mode: 'candle' | 'line' = candles.length >= 2 ? chartMode : 'line';

    let chart: string;
    let geo: ChartGeometry | null = null;
    if (mode === 'candle') {
      chart = candleChartSvg(candles, { formatX: range.fx, formatY: (v) => `€${formatPrice(v)}` });
      geo = candleGeometry(candles);
    } else {
      const points = pts.map((p) => ({ timestamp: p.at, value: p.equity }));
      chart = priceChartSvg(points, { stroke: up ? HOT : COLD, formatX: range.fx, formatY: (v) => `€${formatPrice(v)}` });
      geo = chartGeometry(points);
    }
    const rangeBar = RANGES.map(
      (r) => `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}">${r.key}</button>`,
    ).join('');

    body.innerHTML = `
      <div class="hero">
        <div class="hero-label">Now <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value">€${formatPrice(last)}</div>
        <div class="hero-change ${up ? 'up' : 'down'}">${formatPct(ret)} · ${rangeKey}</div>
        <div class="hero-split"><span>since ${new Date(pts[0]!.at).toLocaleDateString('en-GB')}</span></div>
      </div>
      <div class="chart-controls">
        <div class="range-bar">${rangeBar}</div>
        <div class="chart-toggle">
          <button class="ctoggle-btn ${mode === 'candle' ? 'active' : ''}" data-mode="candle">Candles</button>
          <button class="ctoggle-btn ${mode === 'line' ? 'active' : ''}" data-mode="line">Line</button>
        </div>
      </div>
      <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>`;

    body.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
      b.addEventListener('click', () => { rangeKey = b.dataset['range']!; paint(); });
    });
    body.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const m = b.dataset['mode'];
        if (m === 'candle' || m === 'line') { chartMode = m; paint(); }
      });
    });
    wireCrosshair(geo, mode, candles, range);
  }

  /** Crosshair + tooltip, shared by candle (OHLC) and line (price) modes. */
  function wireCrosshair(geo: ChartGeometry, mode: 'candle' | 'line', candles: Candle[], range: Range): void {
    const svg = body.querySelector<SVGSVGElement>('svg.pchart');
    const tip = body.querySelector<HTMLElement>('.pchart-tip');
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
          ? `<span class="pchart-tip-price">€${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-ohlc">O €${formatPrice(c.open)} · H €${formatPrice(c.high)} · L €${formatPrice(c.low)} · C €${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-time">${stamp}</span>`
          : `<span class="pchart-tip-price">€${formatPrice(c.close)}</span><span class="pchart-tip-time">${stamp}</span>`;
      tip.style.left = `${(px / geo.W) * 100}%`;
      tip.style.top = `${(py / geo.H) * 100}%`;
    };
    const hide = (): void => { cross?.classList.remove('show'); tip.hidden = true; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
    void range;
  }

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      if (history.length === 0) {
        body.innerHTML = '<div class="empty">Couldn\'t reach the cloud robot — retrying.</div>';
      }
      return;
    }
    history = state.equityHistory;
    paint();
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
