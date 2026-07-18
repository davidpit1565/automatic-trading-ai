/**
 * Portfolio value history — opened by tapping the value card on Home.
 * Charts the simulated portfolio value over time with a timeframe selector
 * (1D → All), an interactive crosshair + tooltip (value + date at the pointer),
 * and the gain/loss since tracking began. Read-only; data recorded by the
 * cloud robot each cycle.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { priceChartSvg, chartGeometry } from '../charts';
import { formatPrice, formatPct } from '../format';

const HOT = '#16c784';
const COLD = '#ea3943';
const REFRESH_MS = 60_000;
const DAY = 86_400_000;

interface Range {
  readonly key: string;
  readonly ms: number; // 0 = all
  readonly fx: (ts: number) => string;
}
const RANGES: Range[] = [
  { key: '1D', ms: DAY, fx: (t) => hm(t) },
  { key: '1W', ms: 7 * DAY, fx: (t) => dm(t) },
  { key: '1M', ms: 30 * DAY, fx: (t) => dm(t) },
  { key: '1Y', ms: 365 * DAY, fx: (t) => mon(t) },
  { key: 'All', ms: 0, fx: (t) => dm(t) },
];
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

export function renderValueView(container: HTMLElement, _data: ActiveDataSource): void {
  container.innerHTML = `
    <button class="tool-back" data-nav="home">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <div id="pv-body"><div class="empty">Loading…</div></div>`;
  const body = container.querySelector<HTMLElement>('#pv-body')!;

  let history: { at: number; equity: number }[] = [];
  let rangeKey = 'All';

  function paint(): void {
    if (history.length < 2) {
      body.innerHTML =
        '<div class="empty">Collecting data — the value chart appears after a few cloud runs. Check back soon.</div>';
      return;
    }
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const now = history[history.length - 1]!.at;
    let pts = range.ms > 0 ? history.filter((p) => p.at >= now - range.ms) : history.slice();
    if (pts.length < 2) pts = history.slice(); // fall back to All when the window is too short

    const points = pts.map((p) => ({ timestamp: p.at, value: p.equity }));
    const first = points[0]!.value;
    const last = points[points.length - 1]!.value;
    const ret = first > 0 ? ((last - first) / first) * 100 : 0;
    const up = ret >= 0;
    const chart = priceChartSvg(points, {
      stroke: up ? HOT : COLD,
      formatX: range.fx,
      formatY: (v) => `€${formatPrice(v)}`,
    });
    const rangeBar = RANGES.map(
      (r) => `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}">${r.key}</button>`,
    ).join('');

    body.innerHTML = `
      <div class="hero">
        <div class="hero-label">Now <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value">€${formatPrice(last)}</div>
        <div class="hero-change ${up ? 'up' : 'down'}">${formatPct(ret)} · ${rangeKey}</div>
        <div class="hero-split"><span>since ${new Date(points[0]!.timestamp).toLocaleDateString('en-GB')}</span></div>
      </div>
      <div class="range-bar">${rangeBar}</div>
      <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>`;

    body.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
      b.addEventListener('click', () => { rangeKey = b.dataset['range']!; paint(); });
    });
    wireCrosshair(points);
  }

  /** Crosshair + tooltip over the equity chart (same mapping as the market chart). */
  function wireCrosshair(points: { timestamp: number; value: number }[]): void {
    const svg = body.querySelector<SVGSVGElement>('svg.pchart');
    const tip = body.querySelector<HTMLElement>('.pchart-tip');
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
      crossLine?.setAttribute('x1', px.toFixed(1));
      crossLine?.setAttribute('x2', px.toFixed(1));
      crossDot?.setAttribute('cx', px.toFixed(1));
      crossDot?.setAttribute('cy', py.toFixed(1));
      cross?.classList.add('show');
      tip.hidden = false;
      const stamp = new Date(pt.timestamp).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      tip.innerHTML =
        `<span class="pchart-tip-price">€${formatPrice(pt.value)}</span>` +
        `<span class="pchart-tip-time">${stamp}</span>`;
      tip.style.left = `${(px / geo.W) * 100}%`;
      tip.style.top = `${(py / geo.H) * 100}%`;
    };
    const hide = (): void => { cross?.classList.remove('show'); tip.hidden = true; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
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

  void load();
  window.setInterval(() => void load(), REFRESH_MS);
}
