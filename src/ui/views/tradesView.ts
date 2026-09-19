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
import { formatPrice, formatPct, escapeHtml } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
const euro = (v: number): string => `€${formatPrice(v)}`;

function baseOf(symbol: string): string {
  return symbol.replace(/EUR$|USD$/, '');
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function openPositionCardHtml(p: LiveOpenPosition): string {
  const base = escapeHtml(baseOf(p.symbol));
  return `
    <div class="ops-action-card">
      <div class="ops-action-symbol">${base} · LONG</div>
      <div class="ops-action-row"><span>Quantity</span><span>${p.quantity}</span></div>
      <div class="ops-action-row"><span>Entry price</span><span>${euro(p.entryPrice)}</span></div>
      <div class="ops-action-row"><span>Stop loss</span><span>${euro(p.stopLoss)}</span></div>
      <div class="ops-action-row"><span>Take profit</span><span>${euro(p.takeProfit)}</span></div>
      <div class="ops-action-row"><span>Opened</span><span>${formatDateTime(p.openedAt)}</span></div>
    </div>`;
}

function closedTradeCardHtml(t: CloudLiveJournalEntry): string {
  const base = escapeHtml(baseOf(t.symbol));
  const up = t.realizedPnl >= 0;
  const pnl = `${up ? '+' : '-'}${euro(Math.abs(t.realizedPnl))}`;
  return `
    <div class="ops-action-card">
      <div class="tv-trade-head">
        <div class="ops-action-symbol">${base} · ${escapeHtml(t.exitReason)}</div>
        <div class="tv-trade-pnl ${up ? 'ops-up' : 'ops-down'}">${pnl}</div>
      </div>
      <div class="ops-action-row"><span>Entry → Exit</span><span>${euro(t.entryPrice)} → ${euro(t.exitPrice)}</span></div>
      <div class="ops-action-row"><span>Return</span><span>${formatPct(t.returnPct)}</span></div>
      <div class="ops-action-row"><span>Held</span><span>${formatDuration(t.holdingDurationMs)}</span></div>
      <div class="ops-action-row"><span>Fees (estimated)</span><span>${euro(t.fees)}</span></div>
      <div class="ops-action-row"><span>Slippage (measured)</span><span>${euro(t.slippage)}</span></div>
      <div class="ops-action-row"><span>Closed</span><span>${formatDateTime(t.exitTimestamp)}</span></div>
    </div>`;
}

export function renderTradesView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Trades</h2>
    <p class="view-sub">Every real Revolut X position — open and closed.</p>
    <div class="ops-section">
      <div class="ops-section-title">OPEN POSITIONS <span class="ops-tag-live">REAL MONEY</span></div>
      <div id="tv-open-empty" class="ops-empty" hidden>No open positions.</div>
      <div id="tv-open-list" class="ops-action-list"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">CLOSED TRADES</div>
      <div id="tv-closed-empty" class="ops-empty" hidden>No closed trades yet.</div>
      <div id="tv-closed-list" class="ops-action-list"></div>
    </div>
    <p class="muted-line" id="tv-status">Loading…</p>`;

  const openEmptyEl = container.querySelector<HTMLElement>('#tv-open-empty')!;
  const openListEl = container.querySelector<HTMLElement>('#tv-open-list')!;
  const closedEmptyEl = container.querySelector<HTMLElement>('#tv-closed-empty')!;
  const closedListEl = container.querySelector<HTMLElement>('#tv-closed-list')!;
  const statusEl = container.querySelector<HTMLElement>('#tv-status')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      return;
    }
    const live = state.live;
    const positions = live?.positions ?? [];
    openEmptyEl.hidden = positions.length !== 0;
    openListEl.innerHTML = positions.map(openPositionCardHtml).join('');

    const closed = live?.tradeJournal ?? [];
    closedEmptyEl.hidden = closed.length !== 0;
    closedListEl.innerHTML = closed.map(closedTradeCardHtml).join('');

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
