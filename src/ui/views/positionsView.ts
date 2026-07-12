/**
 * Portfolio tab — Stage 5.
 *
 * Rendering only: positions, cash, analytics, and monitoring insights all
 * come from the Position/Portfolio engines and the trade journal. Opening
 * goes through the verified pipeline (scan → signal → risk) and closing is
 * always an explicit human action — nothing closes automatically.
 */

import { PersistedAuditLog } from '../../core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../core/autopilot/killSwitch';
import { PaperAutoPilot } from '../../core/autopilot/paperAutoPilot';
import { exportState, importState, type BackupPayload } from '../../core/data/backup';
import { LocalStorageStore } from '../../core/data/storage';
import {
  benchmarkComparison,
  confidenceCalibration,
  efficiencyReport,
  exitReasonBreakdown,
  strategyBreakdown,
  type SymbolPriceSpan,
} from '../../core/feedback/performanceFeedback';
import { IntervalScheduler, type MonitorInterval } from '../../core/monitor/scheduler';
import {
  buildEquityCurve,
  monthlyPerformance,
  rollingDrawdownPct,
  tradeAnalytics,
} from '../../core/position/analytics';
import { PortfolioEngine } from '../../core/position/portfolioEngine';
import { PositionEngine } from '../../core/position/positionEngine';
import { assessOpenPosition } from '../../core/position/positionMonitor';
import { TradeJournal } from '../../core/position/tradeJournal';
import { DailyLossTracker } from '../../core/risk/dailyLoss';
import { assessTrade } from '../../core/risk/riskEngine';
import { scanCandles, type ScanResult } from '../../core/scan/marketScanner';
import { evaluateScan } from '../../core/signal/signalEngine';
import type { Timeframe } from '../../core/types';
import { lineChartSvg } from '../charts';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass } from '../format';

const INITIAL_CASH = 10_000;
const BASE_CURRENCY = 'USD';
const TIMEFRAME: Timeframe = '1h';
const STRATEGY_VERSION = 'pipeline-v1';

export function renderPositionsView(container: HTMLElement, data: ActiveDataSource): void {
  const store = new LocalStorageStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash: INITIAL_CASH,
    baseCurrency: BASE_CURRENCY,
  });

  const killSwitch = new PersistedKillSwitch(store);
  const audit = new PersistedAuditLog(store);
  const autopilot = new PaperAutoPilot({
    source: data.source,
    symbols: data.instruments.slice(0, 12).map((i) => i.symbol),
    timeframe: TIMEFRAME,
    confirmationTimeframe: '4h', // never open against the 4h trend
    scheduler: new IntervalScheduler(),
    portfolio,
    positions,
    killSwitch,
    audit,
    getDailyLoss: () => new DailyLossTracker(store).lossToday(Date.now()),
    store,
  });
  // Reload survival: pick the schedule back up if it was running, and run a
  // catch-up cycle immediately — phones suspend background tabs, so every
  // visit should scan and manage positions right away.
  const resumed = autopilot.resume();
  if (resumed) {
    void autopilot.runCycleOnce(Date.now()).then(() => {
      refreshAutopilot();
      void refresh();
    });
  }

  container.innerHTML = `
    <h2>Portfolio</h2>
    <p class="status-line">
      Position tracking and analytics for simulated trades. Opening runs the full verified
      pipeline (scan → signal → risk); closing is your explicit action — or the paper
      autopilot's, using simulated money only.
    </p>
    <div id="pf-overview"></div>

    <h3>Paper Autopilot</h3>
    <p class="status-line">
      Trades completely autonomously with SIMULATED money: qualified entries via the
      verified pipeline, automatic stop-loss / take-profit exits, everything audited.
      No real orders exist anywhere in this platform — live trading would always require
      your explicit confirmation per trade.
    </p>
    <div class="controls">
      <label class="control">Cycle every
        <select id="ap-interval">
          ${(['5m', '15m', '30m', '1h', '4h', '1d'] as MonitorInterval[])
            .map((i) => `<option value="${i}" ${i === '15m' ? 'selected' : ''}>${i}</option>`)
            .join('')}
        </select>
      </label>
      <button class="primary" id="ap-start">Start autopilot</button>
      <button class="secondary" id="ap-stop">Stop</button>
      <button class="secondary" id="ap-cycle">Run cycle now</button>
      <button class="secondary" id="ap-kill">⛔ Kill switch</button>
    </div>
    <div class="status-line" id="ap-status"></div>
    <div id="ap-audit"></div>

    <div class="controls">
      <label class="control">Market
        <select id="pf-symbol">
          ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
        </select>
      </label>
      <button class="primary" id="pf-open">Open via pipeline</button>
      <button class="secondary" id="pf-refresh">Refresh prices</button>
    </div>
    <div class="status-line" id="pf-status"></div>
    <h3>Open positions</h3>
    <div id="pf-positions"></div>
    <h3>Closed trades (journal)</h3>
    <div id="pf-journal"></div>
    <h3>Analytics</h3>
    <div id="pf-analytics"></div>
    <h3>Performance feedback</h3>
    <div id="pf-feedback"></div>
    <h3>Backup</h3>
    <div class="controls">
      <button class="secondary" id="pf-export">Download backup</button>
      <label class="control">Restore from file
        <input id="pf-import" type="file" accept="application/json" />
      </label>
    </div>
    <div class="status-line" id="pf-backup-status"></div>
    <p class="disclaimer">
      Simulated positions only — no real orders exist anywhere in this platform. Metrics
      describe the past; they never promise future results.
    </p>
  `;

  const status = container.querySelector<HTMLElement>('#pf-status')!;

  async function latestScan(symbol: string): Promise<ScanResult | null> {
    const candles = await data.source.getCandles(symbol, TIMEFRAME, 150);
    if (!candles.ok) return null;
    const scan = scanCandles(symbol, TIMEFRAME, candles.value);
    return scan.ok ? scan.value : null;
  }

  async function refresh(): Promise<void> {
    const open = portfolio.openPositions();
    const prices: Record<string, number> = {};
    const scans: Record<string, ScanResult> = {};
    for (const position of open) {
      const scan = await latestScan(position.symbol);
      if (scan) {
        prices[position.symbol] = scan.snapshot.price;
        scans[position.symbol] = scan;
        positions.updateMarketPrice(position.symbol, scan.snapshot.price, Date.now());
      }
    }
    const snapshot = portfolio.snapshot(prices, Date.now());
    renderOverview(container.querySelector('#pf-overview')!, snapshot);
    renderPositions(container.querySelector('#pf-positions')!, portfolio, prices, scans, () => void refresh(), status);
    renderJournal(container.querySelector('#pf-journal')!, journal);
    renderAnalytics(container.querySelector('#pf-analytics')!, journal);
    await renderFeedback(container.querySelector('#pf-feedback')!, journal, data);
  }

  container.querySelector('#pf-open')!.addEventListener('click', async () => {
    const symbol = container.querySelector<HTMLSelectElement>('#pf-symbol')!.value;
    status.textContent = `Running pipeline for ${symbol}…`;
    const scan = await latestScan(symbol);
    if (!scan) {
      status.innerHTML = `<span class="error-line">No market data for ${escapeHtml(symbol)}</span>`;
      return;
    }
    const decision = evaluateScan(scan);
    if (decision.kind === 'rejected') {
      status.innerHTML = `Signal Engine found no qualifying setup: ${escapeHtml(decision.reasons.join('; '))}`;
      return;
    }
    const openPositions = portfolio.openPositions();
    const assessment = assessTrade(
      decision.opportunity,
      {
        equity: portfolio.snapshot({}, Date.now()).equity,
        openPositions: openPositions.map((p) => ({
          symbol: p.symbol,
          quantity: p.quantity,
          entryPrice: p.entryPrice,
        })),
      },
      { dailyLossSoFar: new DailyLossTracker(store).lossToday(Date.now()) },
    );
    if (!assessment.approved) {
      status.innerHTML = `Risk Engine refused the trade: ${escapeHtml(assessment.reasons.join('; '))}`;
      return;
    }
    const opened = portfolio.openFromAssessment(assessment, {
      timestamp: Date.now(),
      confidence: decision.opportunity.confidence,
      strategyVersion: STRATEGY_VERSION,
    });
    status.innerHTML = opened.ok
      ? `Opened ${escapeHtml(symbol)}: ${opened.value.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} @ ${formatPrice(opened.value.entryPrice)}`
      : `<span class="error-line">${escapeHtml(opened.error)}</span>`;
    await refresh();
  });

  container.querySelector('#pf-refresh')!.addEventListener('click', () => void refresh());

  // ---- Autopilot controls -------------------------------------------------
  const autopilotStatus = container.querySelector<HTMLElement>('#ap-status')!;

  function refreshAutopilot(): void {
    const status = autopilot.status();
    const parts = [
      status.killSwitchEngaged
        ? '⛔ KILL SWITCH ENGAGED — all automation halted'
        : status.running
          ? `Autopilot RUNNING (paper money, every ${status.interval})`
          : 'Autopilot stopped.',
      status.lastCycleAt !== null
        ? `Last cycle: ${new Date(status.lastCycleAt).toLocaleString()}`
        : '',
      status.running && status.nextCycleAt !== null
        ? `Next: ${new Date(status.nextCycleAt).toLocaleString()}`
        : '',
      status.lastCycle !== null && !status.lastCycle.halted
        ? `opened ${status.lastCycle.opened.length} / closed ${status.lastCycle.closed.length} / skipped ${status.lastCycle.skipped.length}`
        : '',
    ].filter(Boolean);
    autopilotStatus.textContent = parts.join(' · ');
    renderAudit(container.querySelector('#ap-audit')!, audit);
  }

  container.querySelector('#ap-start')!.addEventListener('click', () => {
    const interval = container.querySelector<HTMLSelectElement>('#ap-interval')!
      .value as MonitorInterval;
    autopilot.start(interval);
    refreshAutopilot();
  });
  container.querySelector('#ap-stop')!.addEventListener('click', () => {
    autopilot.stop();
    refreshAutopilot();
  });
  container.querySelector('#ap-cycle')!.addEventListener('click', () => {
    autopilotStatus.textContent = 'Running autopilot cycle…';
    void autopilot.runCycleOnce(Date.now()).then(async () => {
      refreshAutopilot();
      await refresh();
    });
  });
  container.querySelector('#ap-kill')!.addEventListener('click', () => {
    if (killSwitch.isEngaged()) {
      killSwitch.disengage('dashboard-user');
      audit.append({
        timestamp: Date.now(),
        intentId: 'kill-switch',
        event: 'kill-switch-disengaged',
        mode: 'paper',
        detail: 'kill switch disengaged from the dashboard',
      });
    } else {
      killSwitch.engage('engaged from the dashboard');
      autopilot.stop();
    }
    refreshAutopilot();
  });

  // ---- Backup / restore ---------------------------------------------------
  const backupStatus = container.querySelector<HTMLElement>('#pf-backup-status')!;
  container.querySelector('#pf-export')!.addEventListener('click', () => {
    const payload = exportState(store, Date.now());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `trading-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    backupStatus.textContent = `Backup downloaded (${Object.keys(payload.data).length} data sets).`;
  });
  container.querySelector<HTMLInputElement>('#pf-import')!.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      const result = importState(store, payload);
      backupStatus.innerHTML = result.ok
        ? `Restored ${result.value.restoredKeys} data sets — reload the page to see them.`
        : `<span class="error-line">${escapeHtml(result.error)}</span>`;
    } catch (cause) {
      backupStatus.innerHTML = `<span class="error-line">Could not read backup: ${escapeHtml(String(cause))}</span>`;
    }
  });

  refreshAutopilot();
  void refresh();
}

/** Performance feedback: what the verified history says about the system. */
async function renderFeedback(
  element: Element,
  journal: TradeJournal,
  data: ActiveDataSource,
): Promise<void> {
  const entries = journal.entries();
  if (entries.length === 0) {
    element.innerHTML =
      '<p class="status-line">Feedback appears once closed trades accumulate — let the autopilot run.</p>';
    return;
  }

  const calibration = confidenceCalibration(entries);
  const exits = exitReasonBreakdown(entries);
  const efficiency = efficiencyReport(entries);
  const strategies = strategyBreakdown(entries);

  // Benchmark: equal-weight buy & hold of the traded symbols over the
  // journal's span, priced from the live/demo data source.
  const spans: Record<string, SymbolPriceSpan> = {};
  for (const symbol of new Set(entries.map((t) => t.symbol))) {
    const candles = await data.source.getCandles(symbol, TIMEFRAME, 150);
    if (candles.ok && candles.value.length > 1) {
      spans[symbol] = {
        startPrice: candles.value[0]!.close,
        endPrice: candles.value[candles.value.length - 1]!.close,
      };
    }
  }
  const benchmark = benchmarkComparison(entries, INITIAL_CASH, spans);

  element.innerHTML = `
    ${
      benchmark
        ? `<div class="result-cards">
            <div class="stat-card"><div class="stat-label">System (realized)</div>
              <div class="stat-value ${signClass(benchmark.strategyReturnPct)}">${formatPct(benchmark.strategyReturnPct)}</div></div>
            <div class="stat-card"><div class="stat-label">Buy &amp; hold same markets</div>
              <div class="stat-value ${signClass(benchmark.holdReturnPct)}">${formatPct(benchmark.holdReturnPct)}</div></div>
            <div class="stat-card"><div class="stat-label">Verdict</div>
              <div class="stat-value">${benchmark.beatBenchmark ? 'Beat holding' : 'Holding won'}</div></div>
          </div>`
        : ''
    }
    <h4>Confidence calibration — do higher-confidence signals actually win more?</h4>
    <table class="data-table">
      <thead><tr><th>Confidence</th><th>Trades</th><th>Win rate</th><th>Expectancy</th><th>Total P&amp;L</th></tr></thead>
      <tbody>
        ${calibration
          .map(
            (b) => `<tr>
              <td>${b.label}</td>
              <td>${b.tradeCount}</td>
              <td>${b.winRatePct === null ? '—' : formatPct(b.winRatePct, 0)}</td>
              <td>${b.expectancy === null ? '—' : formatPrice(b.expectancy)}</td>
              <td class="${signClass(b.totalPnl)}">${formatPrice(b.totalPnl)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <h4>Exit quality</h4>
    <table class="data-table">
      <thead><tr><th>Exit reason</th><th>Trades</th><th>Win rate</th><th>Avg P&amp;L</th><th>Total</th></tr></thead>
      <tbody>
        ${exits
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.reason)}</td>
              <td>${r.tradeCount}</td>
              <td>${r.winRatePct === null ? '—' : formatPct(r.winRatePct, 0)}</td>
              <td class="${signClass(r.avgPnl)}">${r.avgPnl === null ? '—' : formatPrice(r.avgPnl)}</td>
              <td class="${signClass(r.totalPnl)}">${formatPrice(r.totalPnl)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p class="status-line">
      Trade management: average best move ${efficiency.avgMfePct === null ? '—' : formatPct(efficiency.avgMfePct)} ·
      average worst move ${efficiency.avgMaePct === null ? '—' : formatPct(-(efficiency.avgMaePct ?? 0))} ·
      captured ${efficiency.avgCapturePct === null ? '—' : formatPct(efficiency.avgCapturePct, 0)} of the best available move ·
      ${efficiency.losersThatWereProfitable} loser(s) were once profitable.
    </p>
    <h4>By strategy</h4>
    <table class="data-table">
      <thead><tr><th>Strategy</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Total P&amp;L</th></tr></thead>
      <tbody>
        ${strategies
          .map(
            (s) => `<tr>
              <td>${escapeHtml(s.strategyVersion)}</td>
              <td>${s.stats.tradeCount}</td>
              <td>${s.stats.winRatePct === null ? '—' : formatPct(s.stats.winRatePct, 0)}</td>
              <td>${s.stats.profitFactor === null ? '—' : s.stats.profitFactor.toFixed(2)}</td>
              <td class="${signClass(s.stats.totalPnl)}">${formatPrice(s.stats.totalPnl)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderAudit(element: Element, audit: PersistedAuditLog): void {
  const entries = [...audit.entries()].reverse().slice(0, 15);
  if (entries.length === 0) {
    element.innerHTML = '<p class="status-line">No automated actions yet.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead>
      <tbody>
        ${entries
          .map(
            (e) => `<tr>
              <td>${new Date(e.timestamp).toLocaleString()}</td>
              <td>${escapeHtml(e.event)}</td>
              <td>${escapeHtml(e.detail)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderOverview(
  element: Element,
  snapshot: ReturnType<PortfolioEngine['snapshot']>,
): void {
  element.innerHTML = `
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Equity (${escapeHtml(snapshot.baseCurrency)})</div>
        <div class="stat-value">${formatPrice(snapshot.equity)}</div></div>
      <div class="stat-card"><div class="stat-label">Cash available</div>
        <div class="stat-value">${formatPrice(snapshot.cashAvailable)}</div></div>
      <div class="stat-card"><div class="stat-label">Open positions</div>
        <div class="stat-value">${snapshot.openPositionCount}</div></div>
      <div class="stat-card"><div class="stat-label">Today's P&amp;L</div>
        <div class="stat-value ${signClass(snapshot.dailyPnl)}">${formatPrice(snapshot.dailyPnl)}</div></div>
      <div class="stat-card"><div class="stat-label">Total return</div>
        <div class="stat-value ${signClass(snapshot.totalReturnPct)}">${formatPct(snapshot.totalReturnPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Exposure</div>
        <div class="stat-value">${snapshot.exposurePct.toFixed(1)}%</div></div>
    </div>
  `;
}

function renderPositions(
  element: Element,
  portfolio: PortfolioEngine,
  prices: Record<string, number>,
  scans: Record<string, ScanResult>,
  refresh: () => void,
  status: HTMLElement,
): void {
  const open = portfolio.openPositions();
  if (open.length === 0) {
    element.innerHTML = '<p class="status-line">No open positions.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Entry</th><th>Price</th><th>Unrealized P&amp;L</th><th>Stop</th>
        <th>Target</th><th>Held</th><th>Confidence</th><th>Regime</th><th></th>
      </tr></thead>
      <tbody>
        ${open
          .map((position) => {
            const price = prices[position.symbol] ?? position.entryPrice;
            const insight = assessOpenPosition(position, {
              price,
              timestamp: Date.now(),
              regime: scans[position.symbol]?.temperature,
            });
            const warnings = insight.warnings
              .map((w) => `<li>⚠ ${escapeHtml(w)}</li>`)
              .join('');
            return `<tr>
              <td>${escapeHtml(position.symbol)}</td>
              <td>${formatPrice(position.entryPrice)}</td>
              <td>${formatPrice(price)}</td>
              <td class="${signClass(insight.unrealizedPnl)}">${formatPrice(insight.unrealizedPnl)} (${formatPct(insight.pnlPct)})</td>
              <td>${formatPrice(position.stopLoss)}</td>
              <td>${formatPrice(position.takeProfit)}</td>
              <td>${(insight.timeInTradeMs / 3_600_000).toFixed(1)}h</td>
              <td>${position.confidence === null ? '—' : position.confidence.toFixed(0)}</td>
              <td>${insight.regime ?? '—'}</td>
              <td>
                <button class="secondary" data-close-half="${escapeHtml(position.id)}">Close ½</button>
                <button class="secondary" data-close-all="${escapeHtml(position.id)}">Close</button>
              </td>
            </tr>${warnings ? `<tr class="scan-detail"><td colspan="10"><ul class="scan-warnings">${warnings}</ul></td></tr>` : ''}`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  const closeAt = (id: string, fraction: number) => {
    const position = portfolio.openPositions().find((p) => p.id === id);
    if (!position) return;
    const price = prices[position.symbol] ?? position.entryPrice;
    const result = portfolio.exit(id, {
      quantity: position.quantity * fraction,
      price,
      timestamp: Date.now(),
      reason: 'manual',
    });
    status.innerHTML = result.ok
      ? `Closed ${fraction === 1 ? 'all' : 'half'} of ${escapeHtml(position.symbol)} @ ${formatPrice(price)}`
      : `<span class="error-line">${escapeHtml(result.error)}</span>`;
    refresh();
  };
  element.querySelectorAll<HTMLButtonElement>('[data-close-half]').forEach((button) =>
    button.addEventListener('click', () => closeAt(button.dataset['closeHalf']!, 0.5)),
  );
  element.querySelectorAll<HTMLButtonElement>('[data-close-all]').forEach((button) =>
    button.addEventListener('click', () => closeAt(button.dataset['closeAll']!, 1)),
  );
}

function renderJournal(element: Element, journal: TradeJournal): void {
  const entries = [...journal.entries()].reverse().slice(0, 30);
  if (entries.length === 0) {
    element.innerHTML = '<p class="status-line">No closed trades yet.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Closed</th><th>Market</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th>
        <th>Return</th><th>Held</th><th>MFE/MAE</th><th>Reason</th><th>Fees</th>
      </tr></thead>
      <tbody>
        ${entries
          .map(
            (t) => `<tr title="${escapeHtml(t.notes ?? '')}">
              <td>${new Date(t.exitTimestamp).toLocaleString()}</td>
              <td>${escapeHtml(t.symbol)}</td>
              <td>${formatPrice(t.entryPrice)}</td>
              <td>${formatPrice(t.exitPrice)}</td>
              <td>${t.positionSize.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
              <td class="${signClass(t.realizedPnl)}">${formatPrice(t.realizedPnl)}</td>
              <td class="${signClass(t.returnPct)}">${formatPct(t.returnPct)}</td>
              <td>${(t.holdingDurationMs / 3_600_000).toFixed(1)}h</td>
              <td>+${t.mfePct.toFixed(1)}% / −${t.maePct.toFixed(1)}%</td>
              <td>${escapeHtml(t.exitReason)}</td>
              <td>${formatPrice(t.fees)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderAnalytics(element: Element, journal: TradeJournal): void {
  const entries = journal.entries();
  if (entries.length === 0) {
    element.innerHTML =
      '<p class="status-line">Analytics appear after the first closed trade.</p>';
    return;
  }
  const stats = tradeAnalytics(entries, { initialCash: INITIAL_CASH });
  const equity = buildEquityCurve(entries, INITIAL_CASH);
  const drawdown = rollingDrawdownPct(equity);
  const months = monthlyPerformance(entries);

  element.innerHTML = `
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Win rate</div>
        <div class="stat-value">${stats.winRatePct === null ? '—' : formatPct(stats.winRatePct, 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Profit factor</div>
        <div class="stat-value">${stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-label">Expectancy / trade</div>
        <div class="stat-value ${signClass(stats.expectancy)}">${stats.expectancy === null ? '—' : formatPrice(stats.expectancy)}</div></div>
      <div class="stat-card"><div class="stat-label">Avg winner / loser</div>
        <div class="stat-value">${stats.avgWinner === null ? '—' : formatPrice(stats.avgWinner)} / ${stats.avgLoser === null ? '—' : formatPrice(stats.avgLoser)}</div></div>
      <div class="stat-card"><div class="stat-label">Largest gain / loss</div>
        <div class="stat-value">${stats.largestGain === null ? '—' : formatPrice(stats.largestGain)} / ${stats.largestLoss === null ? '—' : formatPrice(stats.largestLoss)}</div></div>
      <div class="stat-card"><div class="stat-label">Streaks (W/L)</div>
        <div class="stat-value">${stats.maxConsecutiveWins} / ${stats.maxConsecutiveLosses}</div></div>
      <div class="stat-card"><div class="stat-label">Max drawdown</div>
        <div class="stat-value">${formatPct(-stats.maxDrawdownPct)}</div></div>
      <div class="stat-card"><div class="stat-label">Recovery / Calmar</div>
        <div class="stat-value">${stats.recoveryFactor === null ? '—' : stats.recoveryFactor.toFixed(2)} / ${stats.calmar === null ? '—' : stats.calmar.toFixed(2)}</div></div>
    </div>
    <h4>Equity curve (realized)</h4>
    ${lineChartSvg(
      equity.map((p) => ({ timestamp: p.timestamp, value: p.equity })),
      {
        lineClass: (equity[equity.length - 1]?.equity ?? 0) >= INITIAL_CASH ? 'equity-line-up' : 'equity-line-down',
        ariaLabel: 'Realized equity curve',
      },
    )}
    <h4>Drawdown</h4>
    ${lineChartSvg(
      drawdown.map((p) => ({ timestamp: p.timestamp, value: -p.drawdownPct })),
      { lineClass: 'equity-line-down', ariaLabel: 'Rolling drawdown curve', height: 100 },
    )}
    <h4>Monthly performance</h4>
    <table class="data-table">
      <thead><tr><th>Month</th><th>P&amp;L</th><th>Trades</th></tr></thead>
      <tbody>
        ${months
          .map(
            (m) => `<tr>
              <td>${m.month}</td>
              <td class="${signClass(m.pnl)}">${formatPrice(m.pnl)}</td>
              <td>${m.tradeCount}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}
