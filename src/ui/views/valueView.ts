/**
 * Portfolio value history — opened by tapping the value card on Home.
 * Charts the simulated portfolio value over time with the gain/loss since
 * tracking began. Read-only; data recorded by the cloud robot each cycle.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { priceChartSvg } from '../charts';
import { formatPrice, formatPct } from '../format';

const HOT = '#16c784';
const COLD = '#ea3943';

export function renderValueView(container: HTMLElement, _data: ActiveDataSource): void {
  container.innerHTML = `
    <button class="tool-back" data-nav="home">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <div id="pv-body"><div class="empty">Loading…</div></div>`;
  const body = container.querySelector<HTMLElement>('#pv-body')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      body.innerHTML = '<div class="empty">Couldn\'t reach the cloud robot — retrying.</div>';
      return;
    }
    const history = state.equityHistory;
    if (history.length < 2) {
      body.innerHTML =
        '<div class="empty">Collecting data — the value chart appears after a few cloud runs. Check back soon.</div>';
      return;
    }
    const first = history[0]!.equity;
    const last = history[history.length - 1]!.equity;
    const ret = first > 0 ? ((last - first) / first) * 100 : 0;
    const up = ret >= 0;
    const chart = priceChartSvg(
      history.map((p) => ({ timestamp: p.at, value: p.equity })),
      {
        stroke: up ? HOT : COLD,
        formatX: (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
        formatY: (v) => `€${formatPrice(v)}`,
      },
    );
    body.innerHTML = `
      <div class="hero">
        <div class="hero-label">Now <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value">€${formatPrice(last)}</div>
        <div class="hero-change ${up ? 'up' : 'down'}">${formatPct(ret)} since ${new Date(history[0]!.at).toLocaleDateString('en-GB')}</div>
      </div>
      <div class="detail-chart">${chart}</div>`;
  }

  void load();
  window.setInterval(() => void load(), 60_000);
}
