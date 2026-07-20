/**
 * History — every buy and sell the cloud robot has made, newest first.
 * Read-only; parsed from the committed audit log.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { formatPrice } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const euro = (v: number): string => `€${formatPrice(v)}`;

export function renderHistoryView(container: HTMLElement, _data: ActiveDataSource): ViewHandle {
  container.innerHTML = `
    <h2 class="view-title">History</h2>
    <p class="view-sub">Every simulated buy and sell, newest first.</p>
    <div class="stack" id="history-list"><div class="empty">Loading…</div></div>`;
  const list = container.querySelector<HTMLElement>('#history-list')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      list.innerHTML = '<div class="empty">Couldn\'t reach the cloud robot — retrying automatically.</div>';
      return;
    }
    if (state.history.length === 0) {
      list.innerHTML = '<div class="empty">No trades yet — the robot is waiting for a qualified opportunity.</div>';
      return;
    }
    list.innerHTML = '';
    for (const t of state.history) {
      const buy = t.kind === 'buy';
      const row = document.createElement('div');
      row.className = `row trade ${t.kind}`;
      row.innerHTML = `
        <div class="row-main"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span>
          <div><div class="row-title">${t.symbol}</div>
            <div class="row-sub">${t.note ? t.note : buy ? 'opened' : 'closed'}</div></div></div>
        <div class="row-side"><span class="row-title">${euro(t.price)}</span>
          <span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} units</span>
          <span class="row-sub">${new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`;
      list.appendChild(row);
    }
  }
  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), 60_000);

  return {
    pause: () => window.clearInterval(timer),
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), 60_000);
    },
  };
}
