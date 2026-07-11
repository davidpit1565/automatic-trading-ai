/**
 * Portfolio tab — Stage 5.
 *
 * Rendering only: positions, cash, analytics, and monitoring insights all
 * come from the Position/Portfolio engines and the trade journal. Opening
 * goes through the verified pipeline (scan → signal → risk) and closing is
 * always an explicit human action — nothing closes automatically.
 */

import { LocalStorageStore } from '../../core/data/storage';
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

  container.innerHTML = `
    <h2>Portfolio</h2>
    <p class="status-line">
      Position tracking and analytics for simulated trades. Opening runs the full verified
      pipeline (scan → signal → risk); closing is always your explicit action.
    </p>
    <div id="pf-overview"></div>
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

  void refresh();
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
