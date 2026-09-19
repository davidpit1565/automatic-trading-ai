/**
 * Operations Console — Reports. Aggregate stats over the real Revolut X
 * trade journal — every number here is a plain sum/average/count over
 * `CloudLiveJournalEntry` records already shown individually on the Trades
 * screen, never a separately modelled or estimated figure. Empty (not
 * zero-filled) until at least one real trade has closed in the selected
 * period — and an empty period is distinguished from having no closed
 * trades at all, rather than both reading as an identical blank.
 */

import { fetchCloudState, type CloudLiveJournalEntry } from '../cloudState';
import { escapeHtml } from '../format';
import { baseOf, euro, signedEuro, formatDuration, formatDateTime } from '../opsFormat';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

type Period = '7d' | '30d' | '90d' | 'all';
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};
const PERIOD_LABEL: Record<Period, string> = { '7d': '7D', '30d': '30D', '90d': '90D', all: 'ALL' };

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

function filterByPeriod(trades: readonly CloudLiveJournalEntry[], period: Period): CloudLiveJournalEntry[] {
  if (period === 'all') return [...trades];
  const cutoff = Date.now() - PERIOD_MS[period];
  return trades.filter((t) => t.exitTimestamp >= cutoff);
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
    <div class="tv-filters" role="tablist" aria-label="Report period">
      <button class="tv-filter" data-period="7d" role="tab" aria-selected="false">7D</button>
      <button class="tv-filter" data-period="30d" role="tab" aria-selected="false">30D</button>
      <button class="tv-filter" data-period="90d" role="tab" aria-selected="false">90D</button>
      <button class="tv-filter active" data-period="all" role="tab" aria-selected="true">ALL</button>
    </div>
    <div id="rp-empty" class="ops-empty" hidden></div>
    <div id="rp-body"></div>
    <p class="muted-line" id="rp-status">Loading…</p>`;

  const filterBar = container.querySelector<HTMLElement>('.tv-filters')!;
  const emptyEl = container.querySelector<HTMLElement>('#rp-empty')!;
  const bodyEl = container.querySelector<HTMLElement>('#rp-body')!;
  const statusEl = container.querySelector<HTMLElement>('#rp-status')!;

  let period: Period = 'all';
  let allTrades: CloudLiveJournalEntry[] = [];

  function render(): void {
    const filtered = filterByPeriod(allTrades, period);
    const stats = computeStats(filtered);
    emptyEl.hidden = stats !== null;
    if (!stats) {
      // Distinguishes two different empty reasons — nothing closed in this
      // window vs. no closed live trades at all — which would otherwise
      // both read as an identical blank.
      emptyEl.textContent =
        allTrades.length === 0
          ? 'No closed live trades yet — nothing to report.'
          : `No closed trades in the last ${PERIOD_LABEL[period]}.`;
    }
    bodyEl.innerHTML = stats ? statsHtml(stats) : '';
  }

  filterBar.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('.tv-filter');
    if (!btn) return;
    period = btn.dataset['period'] as Period;
    filterBar.querySelectorAll<HTMLElement>('.tv-filter').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    render();
  });

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      return;
    }
    allTrades = state.live?.tradeJournal ?? [];
    render();
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
