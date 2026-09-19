/**
 * Operations Console — System. Read-only system health: the kill switch's
 * full detail, and the automation heartbeat (when the bot's own scheduled
 * cycle last actually recorded a run) — the two real signals available from
 * the same committed state file everything else in this console reads.
 *
 * Deliberately does NOT show fabricated "Exchange API / Market Data /
 * Execution / Reconciliation" status rows: this app is a static site
 * reading a periodically-committed JSON snapshot, not a live monitoring
 * backend, so a subsystem status it cannot actually verify is not shown as
 * if it could be (this project's "don't fabricate data" rule).
 *
 * Also deliberately omits real-money readiness: that section only ever
 * answers "is it time to turn real money on?", already moot for the live
 * Revolut X account this console covers (see `assetHubView.ts`'s
 * `renderProfit`, which hides that same section once `state.live` exists).
 */

import { fetchCloudState } from '../cloudState';
import { escapeHtml } from '../format';
import { formatDateTime, relativeTime, STALE_MS } from '../opsFormat';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

export function renderSystemView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">System</h2>
    <p class="view-sub">Real signals only — no fabricated subsystem status.</p>
    <div class="ops-section">
      <div class="ops-section-title">KILL SWITCH</div>
      <div id="sy-kill-card" class="ops-action-card"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">AUTOMATION</div>
      <div id="sy-heartbeat-card" class="ops-action-card"></div>
    </div>
    <p class="muted-line" id="sy-status">Loading…</p>`;

  const killCardEl = container.querySelector<HTMLElement>('#sy-kill-card')!;
  const heartbeatCardEl = container.querySelector<HTMLElement>('#sy-heartbeat-card')!;
  const statusEl = container.querySelector<HTMLElement>('#sy-status')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      killCardEl.innerHTML = `<div class="ops-action-row"><span>Status</span><span>Unknown</span></div>`;
      heartbeatCardEl.innerHTML = `<div class="ops-empty">Unknown — unable to load the snapshot.</div>`;
      return;
    }
    const live = state.live;
    killCardEl.innerHTML = !live
      ? `<div class="ops-action-row"><span>Status</span><span>No live account yet</span></div>`
      : live.killSwitchEngaged
        ? `<div class="ops-action-row"><span>Status</span><span class="ops-down">HALTED</span></div>
           <div class="ops-action-row"><span>Reason</span><span>${escapeHtml(live.killSwitchReason ?? 'no reason recorded')}</span></div>
           <div class="ops-action-row"><span>Note</span><span>New orders blocked; open positions untouched</span></div>`
        : `<div class="ops-action-row"><span>Status</span><span class="ops-up">Operational</span></div>`;

    const lastRun = state.lastRunAt;
    const stale = lastRun !== null && Date.now() - lastRun > STALE_MS;
    heartbeatCardEl.innerHTML =
      lastRun === null
        ? `<div class="ops-empty">No automation cycle recorded yet.</div>`
        : `<div class="ops-action-row"><span>Last automation cycle</span><span>${formatDateTime(lastRun)}</span></div>
           <div class="ops-action-row${stale ? ' ops-expired' : ''}"><span>Since</span><span>${relativeTime(lastRun)}${stale ? ' — no recent cycle recorded' : ''}</span></div>`;

    statusEl.textContent = `Updated ${formatDateTime(Date.now())}`;
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
