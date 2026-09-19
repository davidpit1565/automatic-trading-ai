/**
 * Operations Console — Trade Detail. Opened by tapping a closed trade on
 * the Trades screen (`selection.tradeId`, set by that screen's own click
 * listener before this view's `data-nav="trade-detail"` navigation fires).
 *
 * Shows only fields `CloudLiveJournalEntry` actually persists — no signal-
 * vs-fill price breakdown (only the netted `slippage` figure is stored, not
 * a separate signal price), no decision context (confidence/RSI/regime
 * isn't recorded per trade), no audit-event timeline (the audit log isn't
 * correlated to a specific journal entry id). Per this project's rule
 * against fabricating data, those sections are simply not shown rather than
 * invented or approximated.
 */

import { fetchCloudState, type CloudLiveJournalEntry } from '../cloudState';
import { formatPct, escapeHtml } from '../format';
import { baseOf, euro, signedEuro, formatDateTime, formatDuration } from '../opsFormat';
import { selection } from '../selection';
import type { ViewHandle } from '../viewLifecycle';

function detailHtml(t: CloudLiveJournalEntry): string {
  const up = t.realizedPnl >= 0;
  return `
    <div class="ops-section">
      <div class="ops-section-title">RESULT</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Realized P&amp;L</span><span class="${up ? 'ops-up' : 'ops-down'}">${signedEuro(t.realizedPnl)}</span></div>
        <div class="ops-action-row"><span>Return</span><span>${formatPct(t.returnPct)}</span></div>
        <div class="ops-action-row"><span>Exit reason</span><span>${escapeHtml(t.exitReason)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">EXECUTION</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Entry</span><span>${euro(t.entryPrice)} · ${formatDateTime(t.entryTimestamp)}</span></div>
        <div class="ops-action-row"><span>Exit</span><span>${euro(t.exitPrice)} · ${formatDateTime(t.exitTimestamp)}</span></div>
        <div class="ops-action-row"><span>Position size</span><span>${t.positionSize}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">COSTS</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Fees (estimated)</span><span>${euro(t.fees)}</span></div>
        <div class="ops-action-row"><span>Slippage (measured)</span><span>${euro(t.slippage)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">BEHAVIOR</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Holding time</span><span>${formatDuration(t.holdingDurationMs)}</span></div>
        <div class="ops-action-row"><span>Max favorable excursion</span><span>${formatPct(t.mfePct)}</span></div>
        <div class="ops-action-row"><span>Max adverse excursion</span><span>${formatPct(t.maePct)}</span></div>
      </div>
    </div>
    ${
      t.notes
        ? `<div class="ops-section">
      <div class="ops-section-title">NOTES</div>
      <div class="ops-empty">${escapeHtml(t.notes)}</div>
    </div>`
        : ''
    }`;
}

export function renderTradeDetailView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="trades">← Trades</button>
    <h2 class="view-title" id="td-title">Trade detail</h2>
    <div id="td-body"><p class="muted-line">Loading…</p></div>`;

  const titleEl = container.querySelector<HTMLElement>('#td-title')!;
  const bodyEl = container.querySelector<HTMLElement>('#td-body')!;

  async function load(): Promise<void> {
    const id = selection.tradeId;
    if (!id) {
      bodyEl.innerHTML = '<p class="ops-empty">No trade selected.</p>';
      return;
    }
    const state = await fetchCloudState();
    const trade = state?.live?.tradeJournal.find((t) => t.id === id) ?? null;
    if (!trade) {
      bodyEl.innerHTML = '<p class="ops-empty">Trade not found — it may have aged out of the recorded journal.</p>';
      return;
    }
    titleEl.textContent = `${baseOf(trade.symbol)} trade`;
    bodyEl.innerHTML = detailHtml(trade);
  }

  void load();

  return {
    pause: () => {},
    // Re-fetches on every resume rather than caching, since this view is
    // reached anew each time from Trades (no benefit to a live-refresh
    // timer on a single closed, immutable record).
    resume: () => void load(),
  };
}
