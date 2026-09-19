/**
 * Operations Console — Reports. Aggregate stats over the real Revolut X
 * trade journal — every number here is a plain sum/average/count over
 * `CloudLiveJournalEntry` records already shown individually on the Trades
 * screen, never a separately modelled or estimated figure. Empty (not
 * zero-filled) until at least one real trade has closed.
 */

import { fetchCloudState, type CloudLiveJournalEntry } from '../cloudState';
import { escapeHtml } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
const euro = (v: number): string => `€${v.toFixed(2)}`;
// `€${v.toFixed(2)}` on a negative embeds the minus mid-string ("€-5.00") —
// this puts the sign before the currency symbol instead ("-€5.00"), same
// convention overviewView.ts's today's-P&L KPI already settled on.
const signedEuro = (v: number): string => `${v >= 0 ? '+' : '-'}${euro(Math.abs(v))}`;

interface ReportStats {
  readonly tradeCount: number;
  readonly totalPnl: number;
  readonly winRatePct: number;
  readonly avgWin: number | null;
  readonly avgLoss: number | null;
  readonly profitFactor: number | null;
  readonly bestTrade: CloudLiveJournalEntry;
  readonly worstTrade: CloudLiveJournalEntry;
  readonly totalFees: number;
  readonly totalSlippage: number;
  readonly avgHoldingMs: number;
}

function computeStats(trades: readonly CloudLiveJournalEntry[]): ReportStats | null {
  if (trades.length === 0) return null;
  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);
  const sumWins = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const sumLosses = losses.reduce((s, t) => s + t.realizedPnl, 0);
  const sorted = [...trades].sort((a, b) => a.realizedPnl - b.realizedPnl);
  return {
    tradeCount: trades.length,
    totalPnl: trades.reduce((s, t) => s + t.realizedPnl, 0),
    winRatePct: (wins.length / trades.length) * 100,
    avgWin: wins.length > 0 ? sumWins / wins.length : null,
    avgLoss: losses.length > 0 ? sumLosses / losses.length : null,
    profitFactor: sumLosses < 0 ? sumWins / Math.abs(sumLosses) : null,
    worstTrade: sorted[0]!,
    bestTrade: sorted[sorted.length - 1]!,
    totalFees: trades.reduce((s, t) => s + t.fees, 0),
    totalSlippage: trades.reduce((s, t) => s + t.slippage, 0),
    avgHoldingMs: trades.reduce((s, t) => s + t.holdingDurationMs, 0) / trades.length,
  };
}

function formatDuration(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function baseOf(symbol: string): string {
  return symbol.replace(/EUR$|USD$/, '');
}

function statsHtml(s: ReportStats): string {
  return `
    <div class="ops-kpi-row">
      <div class="ops-kpi"><div class="ops-kpi-value ${s.totalPnl >= 0 ? 'ops-up' : 'ops-down'}">${signedEuro(s.totalPnl)}</div><div class="ops-kpi-label">Total realized P&amp;L</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${s.tradeCount}</div><div class="ops-kpi-label">Closed trades</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${s.winRatePct.toFixed(1)}%</div><div class="ops-kpi-label">Win rate</div></div>
      <div class="ops-kpi"><div class="ops-kpi-value">${s.profitFactor !== null ? s.profitFactor.toFixed(2) : '—'}</div><div class="ops-kpi-label">Profit factor</div></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">AVERAGES</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Average win</span><span>${s.avgWin !== null ? euro(s.avgWin) : '—'}</span></div>
        <div class="ops-action-row"><span>Average loss</span><span>${s.avgLoss !== null ? signedEuro(s.avgLoss) : '—'}</span></div>
        <div class="ops-action-row"><span>Average holding time</span><span>${formatDuration(s.avgHoldingMs)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">BEST / WORST TRADE</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Best (${escapeHtml(baseOf(s.bestTrade.symbol))})</span><span class="ops-up">${signedEuro(s.bestTrade.realizedPnl)}</span></div>
        <div class="ops-action-row"><span>Worst (${escapeHtml(baseOf(s.worstTrade.symbol))})</span><span class="ops-down">${signedEuro(s.worstTrade.realizedPnl)}</span></div>
      </div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">COSTS</div>
      <div class="ops-action-card">
        <div class="ops-action-row"><span>Total fees (estimated)</span><span>${euro(s.totalFees)}</span></div>
        <div class="ops-action-row"><span>Total slippage (measured)</span><span>${euro(s.totalSlippage)}</span></div>
      </div>
    </div>`;
}

export function renderReportsView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Reports</h2>
    <p class="view-sub">Aggregate stats over every closed real trade — plain sums and averages, nothing modelled.</p>
    <div id="rp-empty" class="ops-empty" hidden>No closed trades yet — nothing to report.</div>
    <div id="rp-body"></div>
    <p class="muted-line" id="rp-status">Loading…</p>`;

  const emptyEl = container.querySelector<HTMLElement>('#rp-empty')!;
  const bodyEl = container.querySelector<HTMLElement>('#rp-body')!;
  const statusEl = container.querySelector<HTMLElement>('#rp-status')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      return;
    }
    const stats = computeStats(state.live?.tradeJournal ?? []);
    emptyEl.hidden = stats !== null;
    bodyEl.innerHTML = stats ? statsHtml(stats) : '';
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
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
