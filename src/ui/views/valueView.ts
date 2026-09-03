/**
 * Portfolio value history — opened by tapping the value card on Home.
 * Charts the simulated portfolio value over time with a timeframe selector
 * (1D → All), candlesticks by default (bucketed from the real recorded
 * equity samples — open/high/low/close per bucket, not fabricated) with a
 * Line toggle, an interactive crosshair + tooltip, and the gain/loss since
 * tracking began. Read-only; data recorded by the cloud agent each cycle.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { mountEquityChartPanel } from '../equityChartPanel';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

export function renderValueView(container: HTMLElement, _data: ActiveDataSource): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="crypto">← Home</button>
    <h2 class="view-title">Portfolio value</h2>
    <p class="view-sub">Simulated portfolio value over time.</p>
    <div id="pv-body"><div class="empty">Loading…</div></div>`;
  const body = container.querySelector<HTMLElement>('#pv-body')!;
  const panel = mountEquityChartPanel(body);
  let loadedOnce = false;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      if (!loadedOnce) {
        body.innerHTML = '<div class="empty">Couldn\'t reach the cloud agent — retrying.</div>';
      }
      return;
    }
    loadedOnce = true;
    panel.setHistory(state.equityHistory);
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
