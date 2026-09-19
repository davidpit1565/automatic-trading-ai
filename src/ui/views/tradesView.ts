/**
 * Operations Console — Trades. Every REAL Revolut X position, open and
 * closed, reached from Overview's "Recent activity" section (no bottom-nav
 * button of its own, same drill-down convention `valueView.ts` already
 * uses for the simulated portfolio's own value history).
 *
 * Fees are always a cost-rate ESTIMATE (Revolut X reports no real fee
 * figure); slippage is a REAL measurement (signal price vs. actual broker
 * fill) — both are labelled as such inline rather than shown as one
 * unlabelled "cost" figure, per this project's rule against blending
 * measured and estimated numbers.
 */

import { fetchCloudState, type CloudLiveJournalEntry, type LiveOpenPosition } from '../cloudState';
import { formatPct, escapeHtml } from '../format';
import { baseOf, euro, signedEuro, formatDateTime, formatDuration } from '../opsFormat';
import { selection } from '../selection';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

type StatusFilter = 'all' | 'open' | 'closed';

function openPositionCardHtml(p: LiveOpenPosition, equity: number | null): string {
  const base = escapeHtml(baseOf(p.symbol));
  // Honest, entry-anchored risk context — computable from fields the open-
  // position model already carries, unlike unrealized P&L (which would need
  // a current market price this data model doesn't have — see the "never
  // fabricate" note on `renderTradesView` below). Long-only: risk is
  // entry-to-stop, reward is entry-to-target.
  const exposure = p.quantity * p.entryPrice;
  const riskAmount = p.quantity * (p.entryPrice - p.stopLoss);
  const riskPct = equity !== null && equity > 0 ? (riskAmount / equity) * 100 : null;
  const stopDistPct = p.entryPrice > 0 ? ((p.entryPrice - p.stopLoss) / p.entryPrice) * 100 : null;
  const targetDistPct = p.entryPrice > 0 ? ((p.takeProfit - p.entryPrice) / p.entryPrice) * 100 : null;
  return `
    <div class="ops-action-card">
      <div class="ops-action-symbol">${base} · LONG</div>
      <div class="ops-action-row"><span>Quantity</span><span>${p.quantity}</span></div>
      <div class="ops-action-row"><span>Entry price</span><span>${euro(p.entryPrice)}</span></div>
      <div class="ops-action-row"><span>Exposure</span><span>${euro(exposure)}</span></div>
      <div class="ops-action-row"><span>Risk</span><span>${euro(riskAmount)}${riskPct !== null ? ` (${riskPct.toFixed(2)}% of equity)` : ''}</span></div>
      <div class="ops-action-row"><span>Stop loss</span><span>${euro(p.stopLoss)}${stopDistPct !== null ? ` (−${stopDistPct.toFixed(1)}%)` : ''}</span></div>
      <div class="ops-action-row"><span>Take profit</span><span>${euro(p.takeProfit)}${targetDistPct !== null ? ` (+${targetDistPct.toFixed(1)}%)` : ''}</span></div>
      <div class="ops-action-row"><span>Current price</span><span>— <span class="ops-note">unavailable in current snapshot</span></span></div>
      <div class="ops-action-row"><span>Opened</span><span>${formatDateTime(p.openedAt)}</span></div>
    </div>`;
}

function closedTradeCardHtml(t: CloudLiveJournalEntry): string {
  const base = escapeHtml(baseOf(t.symbol));
  const up = t.realizedPnl >= 0;
  return `
    <div class="ops-action-card ops-clickable" data-nav="trade-detail" data-trade-id="${escapeHtml(t.id)}" role="button" tabindex="0">
      <div class="tv-trade-head">
        <div class="ops-action-symbol">${base} · ${escapeHtml(t.exitReason)}</div>
        <div class="tv-trade-pnl ${up ? 'ops-up' : 'ops-down'}">${signedEuro(t.realizedPnl)}</div>
      </div>
      <div class="ops-action-row"><span>Entry → Exit</span><span>${euro(t.entryPrice)} → ${euro(t.exitPrice)}</span></div>
      <div class="ops-action-row"><span>Return</span><span>${formatPct(t.returnPct)}</span></div>
      <div class="ops-action-row"><span>Held</span><span>${formatDuration(t.holdingDurationMs)}</span></div>
      <div class="ops-action-row"><span>Fees (estimated)</span><span>${euro(t.fees)}</span></div>
      <div class="ops-action-row"><span>Slippage (measured)</span><span>${euro(t.slippage)}</span></div>
      <div class="ops-action-row"><span>Closed</span><span>${formatDateTime(t.exitTimestamp)}</span></div>
    </div>`;
}

/** Desktop-only real operations table (see `.tv-table`'s CSS — cards are
 * the mobile representation, this is the desktop one; both render from the
 * same data, CSS picks which is visible at the current width, rather than
 * squeezing a card layout down or a table sideways on a phone). */
function closedTradeRowHtml(t: CloudLiveJournalEntry): string {
  const up = t.realizedPnl >= 0;
  return `
    <tr class="ops-clickable" data-nav="trade-detail" data-trade-id="${escapeHtml(t.id)}" role="button" tabindex="0">
      <td>${formatDateTime(t.exitTimestamp)}</td>
      <td>${escapeHtml(baseOf(t.symbol))}</td>
      <td>${euro(t.entryPrice)}</td>
      <td>${euro(t.exitPrice)}</td>
      <td>${t.positionSize}</td>
      <td class="${up ? 'ops-up' : 'ops-down'}">${signedEuro(t.realizedPnl)}</td>
      <td>${formatPct(t.returnPct)}</td>
      <td>${escapeHtml(t.exitReason)}</td>
      <td>${formatDuration(t.holdingDurationMs)}</td>
      <td>${euro(t.fees)}</td>
      <td>${euro(t.slippage)}</td>
    </tr>`;
}

const CLOSED_TABLE_HEAD = `
  <thead><tr>
    <th>Closed</th><th>Asset</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th>
    <th>Return</th><th>Exit reason</th><th>Held</th><th>Fees (est.)</th><th>Slippage (meas.)</th>
  </tr></thead>`;

export function renderTradesView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Trades</h2>
    <p class="view-sub">Every real Revolut X position — open and closed.</p>
    <div class="tv-filters" role="tablist" aria-label="Filter trades by status">
      <button class="tv-filter active" data-status="all" role="tab" aria-selected="true">All</button>
      <button class="tv-filter" data-status="open" role="tab" aria-selected="false">Open</button>
      <button class="tv-filter" data-status="closed" role="tab" aria-selected="false">Closed</button>
      <select id="tv-asset-filter" class="tv-asset-select" aria-label="Filter by asset">
        <option value="">All assets</option>
      </select>
    </div>
    <div class="ops-section" id="tv-open-section">
      <div class="ops-section-title"><span class="ops-section-label">OPEN POSITIONS</span> <span class="ops-tag-live">REAL MONEY</span></div>
      <div id="tv-open-empty" class="ops-empty" hidden>No open positions.</div>
      <div id="tv-open-list" class="ops-action-list"></div>
    </div>
    <div class="ops-section" id="tv-closed-section">
      <div class="ops-section-title">CLOSED TRADES</div>
      <div id="tv-closed-empty" class="ops-empty" hidden>No closed trades yet.</div>
      <div id="tv-closed-list" class="ops-action-list tv-cards-only"></div>
      <div class="tv-table-wrap tv-table-only">
        <table class="tv-table">
          ${CLOSED_TABLE_HEAD}
          <tbody id="tv-closed-table-body"></tbody>
        </table>
      </div>
    </div>
    <p class="muted-line" id="tv-status">Loading…</p>`;

  const filterBar = container.querySelector<HTMLElement>('.tv-filters')!;
  const assetSelect = container.querySelector<HTMLSelectElement>('#tv-asset-filter')!;
  const openSectionEl = container.querySelector<HTMLElement>('#tv-open-section')!;
  const closedSectionEl = container.querySelector<HTMLElement>('#tv-closed-section')!;
  const openEmptyEl = container.querySelector<HTMLElement>('#tv-open-empty')!;
  const openListEl = container.querySelector<HTMLElement>('#tv-open-list')!;
  const closedEmptyEl = container.querySelector<HTMLElement>('#tv-closed-empty')!;
  const closedListEl = container.querySelector<HTMLElement>('#tv-closed-list')!;
  const closedTableBodyEl = container.querySelector<HTMLElement>('#tv-closed-table-body')!;
  const statusEl = container.querySelector<HTMLElement>('#tv-status')!;

  let statusFilter: StatusFilter = 'all';
  let assetFilter = '';
  let positions: LiveOpenPosition[] = [];
  let closed: CloudLiveJournalEntry[] = [];
  let equity: number | null = null;

  function render(): void {
    const showOpen = statusFilter === 'all' || statusFilter === 'open';
    const showClosed = statusFilter === 'all' || statusFilter === 'closed';
    openSectionEl.hidden = !showOpen;
    closedSectionEl.hidden = !showClosed;

    const filteredPositions = positions.filter((p) => !assetFilter || baseOf(p.symbol) === assetFilter);
    openEmptyEl.hidden = filteredPositions.length !== 0;
    openListEl.innerHTML = filteredPositions.map((p) => openPositionCardHtml(p, equity)).join('');

    const filteredClosed = closed.filter((t) => !assetFilter || baseOf(t.symbol) === assetFilter);
    closedEmptyEl.hidden = filteredClosed.length !== 0;
    closedListEl.innerHTML = filteredClosed.map(closedTradeCardHtml).join('');
    closedTableBodyEl.innerHTML = filteredClosed.map(closedTradeRowHtml).join('');
  }

  filterBar.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('.tv-filter');
    if (!btn) return;
    statusFilter = btn.dataset['status'] as StatusFilter;
    filterBar.querySelectorAll<HTMLElement>('.tv-filter').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    render();
  });
  assetSelect.addEventListener('change', () => {
    assetFilter = assetSelect.value;
    render();
  });

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      return;
    }
    const live = state.live;
    positions = live?.positions ?? [];
    closed = live?.tradeJournal ?? [];
    equity = live ? (live.equityHistory.at(-1)?.equity ?? live.cash) : null;

    const assets = Array.from(new Set([...positions.map((p) => baseOf(p.symbol)), ...closed.map((t) => baseOf(t.symbol))])).sort();
    const previousValue = assetSelect.value;
    assetSelect.innerHTML =
      '<option value="">All assets</option>' + assets.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    if (assets.includes(previousValue)) assetSelect.value = previousValue;
    else assetFilter = '';

    render();
    statusEl.textContent = `Updated ${formatDateTime(Date.now())}`;
  }

  container.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-trade-id]');
    if (!card) return;
    selection.tradeId = card.dataset['tradeId'] ?? null;
  });

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
