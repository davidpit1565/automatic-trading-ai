/**
 * Monitoring tab — Stage 4.
 *
 * Rendering only: the MonitoringEngine (core) does all orchestration.
 * The UI starts/stops the scheduler, triggers manual scans, and displays
 * status, opportunities, watchlists, opportunity history, and alerts.
 */

import { LocalStorageStore } from '../../core/data/storage';
import { AlertEngine, type Alert } from '../../core/monitor/alerts';
import { MonitoringEngine } from '../../core/monitor/monitoringEngine';
import { OpportunityLog } from '../../core/monitor/opportunityLog';
import { IntervalScheduler, type MonitorInterval } from '../../core/monitor/scheduler';
import { makeWalkForwardValidator } from '../../core/monitor/validationProvider';
import { WatchlistStore } from '../../core/monitor/watchlist';
import { PaperPortfolio } from '../../core/portfolio/paperPortfolio';
import { DailyLossTracker } from '../../core/risk/dailyLoss';
import type { ActiveDataSource } from '../dataSource';
import {
  browserNotificationChannel,
  inAppChannel,
  requestNotificationPermission,
} from '../alertChannels';
import { escapeHtml, formatPrice, signClass } from '../format';

const MONITOR_SYMBOL_LIMIT = 12;
const ALERT_COOLDOWN_MS = 3_600_000; // one hour per symbol+timeframe
const MONITOR_COSTS = { initialCash: 10_000, feeRate: 0.001, spreadPct: 0.001, slippagePct: 0.0005 };

export function renderMonitoringView(container: HTMLElement, data: ActiveDataSource): void {
  const store = new LocalStorageStore();
  const watchlist = new WatchlistStore(store);
  const log = new OpportunityLog(store);
  const liveAlerts: Alert[] = [];
  const alerts = new AlertEngine(
    store,
    [inAppChannel((alert) => liveAlerts.push(alert)), browserNotificationChannel()],
    { cooldownMs: ALERT_COOLDOWN_MS },
  );
  const engine = new MonitoringEngine({
    source: data.source,
    symbols: data.instruments.slice(0, MONITOR_SYMBOL_LIMIT).map((i) => i.symbol),
    timeframe: '1h',
    confirmationTimeframe: '4h', // never qualify a long against the 4h trend
    scheduler: new IntervalScheduler(),
    watchlist,
    log,
    alerts,
    getPortfolio: () => {
      const paper = new PaperPortfolio(store);
      return {
        equity: paper.equity({}),
        openPositions: paper
          .positions()
          .map((p) => ({ symbol: p.symbol, quantity: p.quantity, entryPrice: p.avgCost })),
      };
    },
    getDailyLoss: () => new DailyLossTracker(store).lossToday(Date.now()),
    validator: makeWalkForwardValidator(MONITOR_COSTS),
  });

  container.innerHTML = `
    <h2>Monitoring</h2>
    <p class="status-line">
      Continuous scheduled scans through the verified pipeline: scanner → signal engine →
      risk engine → validation. Analysis only — nothing is ever traded automatically.
    </p>
    <div class="controls">
      <label class="control">Interval
        <select id="mon-interval">
          ${(['5m', '15m', '30m', '1h', '4h', '1d'] as MonitorInterval[])
            .map((i) => `<option value="${i}" ${i === '15m' ? 'selected' : ''}>${i}</option>`)
            .join('')}
        </select>
      </label>
      <button class="primary" id="mon-start">Start monitoring</button>
      <button class="secondary" id="mon-stop">Stop</button>
      <button class="secondary" id="mon-scan-now">Scan now</button>
      <button class="secondary" id="mon-notify-perm">Enable browser notifications</button>
    </div>
    <div class="status-line" id="mon-status">Monitoring stopped.</div>
    <h3>Current opportunities</h3>
    <div id="mon-opportunities"><p class="status-line">No scan has run yet.</p></div>
    <h3>Watchlist</h3>
    <div class="controls">
      <label class="control">Add symbol
        <select id="mon-watch-symbol">
          ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
        </select>
      </label>
      <button class="secondary" id="mon-watch-add">Add to watchlist</button>
    </div>
    <div id="mon-watchlist"></div>
    <h3>Opportunity history</h3>
    <div id="mon-history"></div>
    <h3>Alert history</h3>
    <div id="mon-alerts"></div>
    <p class="disclaimer">
      Alerts flag technical evidence for review — they are not trade instructions and not
      financial advice.
    </p>
  `;

  const statusLine = container.querySelector<HTMLElement>('#mon-status')!;

  function refreshStatus(): void {
    const status = engine.status();
    const parts = [
      status.running ? `Monitoring RUNNING (every ${status.interval})` : 'Monitoring stopped.',
      status.lastScanAt !== null ? `Last scan: ${new Date(status.lastScanAt).toLocaleString()}` : 'No scan yet.',
      status.running && status.nextScanAt !== null
        ? `Next scan: ${new Date(status.nextScanAt).toLocaleString()}`
        : '',
      status.lastResult !== null
        ? `${status.lastResult.outcomes.filter((o) => o.outcome === 'qualified').length} qualified / ` +
          `${status.lastResult.outcomes.filter((o) => o.outcome === 'watch').length} watch / ` +
          `${status.lastResult.failures.length} failed`
        : '',
    ].filter(Boolean);
    statusLine.textContent = parts.join(' · ');
  }

  function refreshAll(): void {
    refreshStatus();
    renderOpportunities(container.querySelector('#mon-opportunities')!, engine);
    renderWatchlist(container.querySelector('#mon-watchlist')!, engine, watchlist, refreshAll);
    renderHistory(container.querySelector('#mon-history')!, engine);
    renderAlerts(container.querySelector('#mon-alerts')!, engine);
  }

  container.querySelector('#mon-start')!.addEventListener('click', () => {
    const interval = container.querySelector<HTMLSelectElement>('#mon-interval')!
      .value as MonitorInterval;
    engine.start(interval);
    refreshStatus();
  });
  container.querySelector('#mon-stop')!.addEventListener('click', () => {
    engine.stop();
    refreshStatus();
  });
  container.querySelector('#mon-scan-now')!.addEventListener('click', () => {
    statusLine.textContent = 'Scanning…';
    void engine.runScanOnce(Date.now()).then(refreshAll);
  });
  container.querySelector('#mon-notify-perm')!.addEventListener('click', () => {
    void requestNotificationPermission();
  });
  container.querySelector('#mon-watch-add')!.addEventListener('click', () => {
    const symbol = container.querySelector<HTMLSelectElement>('#mon-watch-symbol')!.value;
    watchlist.addManual(symbol, Date.now());
    refreshAll();
  });

  refreshAll();
}

function renderOpportunities(element: Element, engine: MonitoringEngine): void {
  const result = engine.status().lastResult;
  if (!result) {
    element.innerHTML = '<p class="status-line">No scan has run yet.</p>';
    return;
  }
  const qualified = result.outcomes.filter((o) => o.outcome === 'qualified');
  if (qualified.length === 0) {
    element.innerHTML =
      '<p class="status-line">No qualified opportunities in the last scan — refusing weak setups is the system protecting capital.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Price</th><th>Confidence</th><th>Entry</th><th>Stop</th>
        <th>Target</th><th>Size</th><th>Risk %</th><th>Validation</th>
      </tr></thead>
      <tbody>
        ${qualified
          .map(({ opportunity: o }) => `<tr title="${escapeHtml(o!.explanation)}">
            <td>${escapeHtml(o!.symbol)}</td>
            <td>${formatPrice(o!.price)}</td>
            <td>${o!.confidence.toFixed(0)}</td>
            <td>${formatPrice(o!.entry)}</td>
            <td>${formatPrice(o!.stopLoss)}</td>
            <td>${formatPrice(o!.takeProfit)}</td>
            <td>${o!.positionSize.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
            <td>${o!.riskPct.toFixed(2)}%</td>
            <td>${escapeHtml(o!.validationVerdict)}</td>
          </tr>`)
          .join('')}
      </tbody>
    </table>
  `;
}

function renderWatchlist(
  element: Element,
  engine: MonitoringEngine,
  watchlist: { toggleFavorite(s: string): void; remove(s: string): void },
  refresh: () => void,
): void {
  const entries = engine.watchlistEntries();
  if (entries.length === 0) {
    element.innerHTML = '<p class="status-line">Watchlist is empty.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Source</th><th>Status</th><th>Best confidence</th>
        <th>First detected</th><th>Last scan</th><th></th>
      </tr></thead>
      <tbody>
        ${entries
          .map(
            (e) => `<tr>
              <td>${e.favorite ? '★ ' : ''}${escapeHtml(e.symbol)}</td>
              <td>${e.source}</td>
              <td>${e.currentStatus}</td>
              <td>${e.highestConfidence === null ? '—' : e.highestConfidence.toFixed(0)}</td>
              <td>${e.firstDetectedAt === null ? '—' : new Date(e.firstDetectedAt).toLocaleString()}</td>
              <td>${e.lastScanAt === null ? '—' : new Date(e.lastScanAt).toLocaleString()}</td>
              <td>
                <button class="secondary" data-fav="${escapeHtml(e.symbol)}">${e.favorite ? 'Unfavourite' : 'Favourite'}</button>
                <button class="secondary" data-del="${escapeHtml(e.symbol)}">Remove</button>
              </td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
  element.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((button) =>
    button.addEventListener('click', () => {
      watchlist.toggleFavorite(button.dataset['fav']!);
      refresh();
    }),
  );
  element.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((button) =>
    button.addEventListener('click', () => {
      watchlist.remove(button.dataset['del']!);
      refresh();
    }),
  );
}

function renderHistory(element: Element, engine: MonitoringEngine): void {
  const records = [...engine.opportunityHistory()].reverse().slice(0, 25);
  if (records.length === 0) {
    element.innerHTML = '<p class="status-line">No opportunities recorded yet.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Detected</th><th>Market</th><th>Confidence</th><th>Entry</th>
        <th>RSI</th><th>ADX</th><th>Validation</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${records
          .map(
            (r) => `<tr>
              <td>${new Date(r.detectedAt).toLocaleString()}</td>
              <td>${escapeHtml(r.symbol)}</td>
              <td>${r.confidence.toFixed(0)}</td>
              <td>${formatPrice(r.entry)}</td>
              <td>${r.snapshot.rsi === null ? '—' : r.snapshot.rsi.toFixed(0)}</td>
              <td>${r.snapshot.adx === null ? '—' : r.snapshot.adx.toFixed(0)}</td>
              <td>${escapeHtml(r.validationVerdict)}</td>
              <td class="${r.disappearedAt === null ? 'positive' : ''}">${
                r.disappearedAt === null
                  ? 'active'
                  : `gone ${new Date(r.disappearedAt).toLocaleString()}`
              }</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderAlerts(element: Element, engine: MonitoringEngine): void {
  const alerts = [...engine.alertHistory()].reverse().slice(0, 25);
  if (alerts.length === 0) {
    element.innerHTML = '<p class="status-line">No alerts yet.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Confidence</th><th>Message</th></tr></thead>
      <tbody>
        ${alerts
          .map(
            (a) => `<tr>
              <td>${new Date(a.createdAt).toLocaleString()}</td>
              <td>${escapeHtml(a.symbol)}</td>
              <td class="${signClass(a.confidence)}">${a.confidence.toFixed(0)}</td>
              <td>${escapeHtml(a.message.slice(0, 140))}…</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}
