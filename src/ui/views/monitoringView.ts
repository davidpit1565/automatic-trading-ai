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
import { escapeHtml, formatNumber, formatPrice, signClass, truncate } from '../format';

const MONITOR_SYMBOL_LIMIT = 12;
const ALERT_COOLDOWN_MS = 3_600_000; // one hour per symbol+timeframe
const MONITOR_COSTS = { initialCash: 10_000, feeRate: 0.001, spreadPct: 0.001, slippagePct: 0.0005 };

/** Same star used by Markets' own watchlist toggle (`marketsView.ts`'s
 * `.star-btn`) — this row used to prefix a favourited symbol with a plain
 * "★" text glyph, the one place in the app spelling "favourite" with a
 * bare Unicode character instead of the shared icon. */
const FAVORITE_ICON =
  '<svg class="watch-fav-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

/** Maps a validation verdict to the app's own robust/caution/overfitted/
 * insufficient-data colour language — already defined in styles.css for
 * the Backtest/Validation tabs' `.verdict-panel`, but never applied to
 * Monitoring's own tables, which showed every verdict as flat grey text. */
function verdictClass(verdict: string): string {
  return `verdict-text-${verdict}`;
}

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
    <h2 class="view-title">Monitoring</h2>
    <p class="view-sub">
      Continuous scheduled scans through the verified pipeline: scanner → signal engine →
      risk engine → validation. Analysis only — nothing is ever traded automatically.
    </p>
    <section class="block">
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
      <div class="stat-row" id="mon-status"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Current opportunities</h2></div>
      <div id="mon-opportunities"><div class="empty">No scan has run yet.</div></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Watchlist</h2></div>
      <div class="controls">
        <label class="control">Add symbol
          <select id="mon-watch-symbol">
            ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
          </select>
        </label>
        <button class="secondary" id="mon-watch-add">Add to watchlist</button>
      </div>
      <div id="mon-watchlist"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Opportunity history</h2></div>
      <div id="mon-history"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Alert history</h2></div>
      <div id="mon-alerts"></div>
    </section>
    <p class="disclaimer">
      Alerts flag technical evidence for review — they are not trade instructions and not
      financial advice.
    </p>
  `;

  const statusLine = container.querySelector<HTMLElement>('#mon-status')!;
  const startButton = container.querySelector<HTMLButtonElement>('#mon-start')!;
  const stopButton = container.querySelector<HTMLButtonElement>('#mon-stop')!;
  const scanNowButton = container.querySelector<HTMLButtonElement>('#mon-scan-now')!;

  /** A run-on "· "-joined sentence made a viewer parse four unrelated facts
   * (is it running, when did it last scan, when's the next one, what did it
   * find) out of one paragraph — a `.stat-tile` per fact, the same
   * component every other result screen in the app now uses for exactly
   * this shape of "small label + value", reads at a glance instead. */
  function refreshStatus(): void {
    const status = engine.status();
    const running = status.running;
    // Start/Stop used to stay enabled regardless of the engine's own
    // running state — clicking Start while already RUNNING (or Stop while
    // already stopped) silently did nothing, with no visual cue either way.
    startButton.disabled = running;
    stopButton.disabled = !running;
    const lastScanText = status.lastScanAt !== null ? new Date(status.lastScanAt).toLocaleString() : 'No scan yet';
    const outcomeTile =
      status.lastResult !== null
        ? (() => {
            const qualifiedCount = status.lastResult.outcomes.filter((o) => o.outcome === 'qualified').length;
            const watchCount = status.lastResult.outcomes.filter((o) => o.outcome === 'watch').length;
            const failedCount = status.lastResult.failures.length;
            // Still one tile (three related counts from a single scan), but
            // each number now carries the same green/red/neutral language
            // signClass already gives every other count in this app instead
            // of three plain white numbers a reader had to weigh themselves.
            return (
              `<div class="stat-tile"><div class="stat-tile-value">` +
              `<span class="${qualifiedCount > 0 ? 'up' : ''}">${qualifiedCount}</span> qualified / ` +
              `<span>${watchCount}</span> watch / ` +
              `<span class="${failedCount > 0 ? 'down' : ''}">${failedCount}</span> failed` +
              `</div><div class="stat-tile-label">Last scan outcome</div></div>`
            );
          })()
        : '';
    const nextScanTile =
      running && status.nextScanAt !== null
        ? `<div class="stat-tile"><div class="stat-tile-value">${new Date(status.nextScanAt).toLocaleString()}</div><div class="stat-tile-label">Next scan</div></div>`
        : '';
    statusLine.innerHTML = `
      <div class="stat-tile"><div class="stat-tile-value ${running ? 'up' : ''}">${running ? `RUNNING (every ${status.interval})` : 'stopped'}</div><div class="stat-tile-label">Status</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${lastScanText}</div><div class="stat-tile-label">Last scan</div></div>
      ${nextScanTile}
      ${outcomeTile}
    `;
  }

  function refreshAll(): void {
    refreshStatus();
    renderOpportunities(container.querySelector('#mon-opportunities')!, engine);
    renderWatchlist(container.querySelector('#mon-watchlist')!, engine, watchlist, refreshAll);
    renderHistory(container.querySelector('#mon-history')!, engine);
    renderAlerts(container.querySelector('#mon-alerts')!, engine);
  }

  startButton.addEventListener('click', () => {
    const interval = container.querySelector<HTMLSelectElement>('#mon-interval')!
      .value as MonitorInterval;
    engine.start(interval);
    refreshStatus();
  });
  stopButton.addEventListener('click', () => {
    engine.stop();
    refreshStatus();
  });
  scanNowButton.addEventListener('click', () => {
    // Market Scan's own "Run scan" already disables itself for the
    // duration of a scan; this button never did, so a second click while
    // one manual scan was still in flight could fire a second overlapping
    // run.
    scanNowButton.disabled = true;
    statusLine.textContent = 'Scanning…';
    // The opportunities table used to sit untouched showing the PREVIOUS
    // scan's results with no sign a new scan was in flight — the same
    // stale-content-during-refetch bug class already fixed once in Markets'
    // view-tabs (PR #203). A real scan against Kraken (unlike the demo
    // source) can take several seconds for 12 symbols, so this window is
    // genuinely visible, not just theoretical.
    container.querySelector('#mon-opportunities')!.innerHTML = '<div class="empty">Scanning…</div>';
    void engine
      .runScanOnce(Date.now())
      .then(refreshAll)
      .finally(() => {
        scanNowButton.disabled = false;
      });
  });
  container.querySelector('#mon-notify-perm')!.addEventListener('click', () => {
    // Used to call this and discard the result — the button gave zero
    // feedback either way, even though the promise already resolves with
    // exactly what happened (granted/denied/unsupported).
    void requestNotificationPermission().then((permission) => {
      if (permission === 'granted') window.toast.success('Browser notifications enabled.');
      else if (permission === 'unsupported') window.toast.info('This browser does not support notifications.');
      else window.toast.warning('Notifications are blocked — enable them in your browser settings.');
    });
  });
  container.querySelector('#mon-watch-add')!.addEventListener('click', () => {
    const symbol = container.querySelector<HTMLSelectElement>('#mon-watch-symbol')!.value;
    watchlist.addManual(symbol, Date.now());
    refreshAll();
  });

  refreshAll();
}

/** Hints that a wide data-table scrolls further right than the visible edge
 * shows — the same affordance Backtest/Validation's own wide tables already
 * established (`.table-scroll-fade`), missing from all four of this
 * screen's tables even though they're at least as wide (up to 9 columns).
 * Kept as a small, self-contained per-screen helper rather than a shared
 * import, matching those two files' own documented reasoning for not
 * coupling independent tool screens together. */
function initTableScrollFade(wrap: HTMLElement): void {
  const scroller = wrap.querySelector<HTMLElement>('.table-scroll');
  if (!scroller) return;
  const update = (): void => {
    wrap.classList.toggle('is-scrollable', scroller.scrollWidth > scroller.clientWidth + 1);
    wrap.classList.toggle(
      'is-scrolled-end',
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1,
    );
  };
  update();
  scroller.addEventListener('scroll', update, { passive: true });
}

function renderOpportunities(element: Element, engine: MonitoringEngine): void {
  const result = engine.status().lastResult;
  if (!result) {
    element.innerHTML = '<div class="empty">No scan has run yet.</div>';
    return;
  }
  const qualified = result.outcomes.filter((o) => o.outcome === 'qualified');
  // Every monitored symbol failed to even fetch (network down) must not read
  // as "the market genuinely has nothing worth trading" — the exact same
  // `result.failures` shape the sibling Market Scan view already surfaces
  // distinctly via its own `.scan-failures`/`.error-line`, silently dropped
  // here even though `MonitorScanResult` already carries it.
  const allFailed = result.outcomes.length === 0 && result.failures.length > 0;
  if (qualified.length === 0) {
    element.innerHTML = allFailed
      ? `<p class="error-line">Scan failed for all ${result.failures.length} monitored markets — check your connection and try "Scan now" again.</p>`
      : '<div class="empty">No qualified opportunities in the last scan — refusing weak setups is the system protecting capital.</div>';
  } else {
    element.innerHTML = `
    <div class="table-scroll-fade">
    <div class="table-scroll">
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
            <td class="${signClass(o!.confidence)}">${o!.confidence.toFixed(0)}</td>
            <td>${formatPrice(o!.entry)}</td>
            <td>${formatPrice(o!.stopLoss)}</td>
            <td>${formatPrice(o!.takeProfit)}</td>
            <td>${o!.positionSize.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
            <td>${o!.riskPct.toFixed(2)}%</td>
            <td class="${verdictClass(o!.validationVerdict)}">${escapeHtml(o!.validationVerdict)}</td>
          </tr>`)
          .join('')}
      </tbody>
    </table>
    </div>
    </div>
  `;
    initTableScrollFade(element.querySelector<HTMLElement>('.table-scroll-fade')!);
  }
  if (result.failures.length > 0 && !allFailed) {
    element.insertAdjacentHTML(
      'beforeend',
      `<div class="scan-failures"><strong>Not scanned (${result.failures.length}):</strong> ${result.failures
        .map((f) => `${escapeHtml(f.symbol)} — ${escapeHtml(f.reason)}`)
        .join('; ')}</div>`,
    );
  }
}

function renderWatchlist(
  element: Element,
  engine: MonitoringEngine,
  watchlist: { toggleFavorite(s: string): void; remove(s: string): void },
  refresh: () => void,
): void {
  const entries = engine.watchlistEntries();
  if (entries.length === 0) {
    element.innerHTML = '<div class="empty">Watchlist is empty.</div>';
    return;
  }
  element.innerHTML = `
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr>
        <th>Market</th><th>Source</th><th>Status</th><th>Best confidence</th>
        <th>First detected</th><th>Last scan</th><th></th>
      </tr></thead>
      <tbody>
        ${entries
          .map((e) => {
            const statusClass =
              e.currentStatus === 'qualified' ? 'positive' : e.currentStatus === 'none' ? 'watch-status-none' : '';
            return `<tr>
              <td>${e.favorite ? FAVORITE_ICON : ''}${escapeHtml(e.symbol)}</td>
              <td>${e.source}</td>
              <td class="${statusClass}">${e.currentStatus}</td>
              <td class="${signClass(e.highestConfidence)}">${e.highestConfidence === null ? '—' : e.highestConfidence.toFixed(0)}</td>
              <td>${e.firstDetectedAt === null ? '—' : new Date(e.firstDetectedAt).toLocaleString()}</td>
              <td>${e.lastScanAt === null ? '—' : new Date(e.lastScanAt).toLocaleString()}</td>
              <td>
                <button class="secondary table-action" data-fav="${escapeHtml(e.symbol)}">${e.favorite ? 'Unfavourite' : 'Favourite'}</button>
                <button class="secondary table-action" data-del="${escapeHtml(e.symbol)}">Remove</button>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    </div>
    </div>
  `;
  initTableScrollFade(element.querySelector<HTMLElement>('.table-scroll-fade')!);
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
    element.innerHTML = '<div class="empty">No opportunities recorded yet.</div>';
    return;
  }
  element.innerHTML = `
    <div class="table-scroll-fade">
    <div class="table-scroll">
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
              <td class="${signClass(r.confidence)}">${r.confidence.toFixed(0)}</td>
              <td>${formatPrice(r.entry)}</td>
              <td>${formatNumber(r.snapshot.rsi)}</td>
              <td>${formatNumber(r.snapshot.adx)}</td>
              <td class="${verdictClass(r.validationVerdict)}">${escapeHtml(r.validationVerdict)}</td>
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
    </div>
    </div>
  `;
  initTableScrollFade(element.querySelector<HTMLElement>('.table-scroll-fade')!);
}

function renderAlerts(element: Element, engine: MonitoringEngine): void {
  const alerts = [...engine.alertHistory()].reverse().slice(0, 25);
  if (alerts.length === 0) {
    element.innerHTML = '<div class="empty">No alerts yet.</div>';
    return;
  }
  element.innerHTML = `
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Confidence</th><th>Message</th></tr></thead>
      <tbody>
        ${alerts
          .map(
            (a) => `<tr>
              <td>${new Date(a.createdAt).toLocaleString()}</td>
              <td>${escapeHtml(a.symbol)}</td>
              <td class="${signClass(a.confidence)}">${a.confidence.toFixed(0)}</td>
              <td>${escapeHtml(truncate(a.message, 140))}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    </div>
    </div>
  `;
  initTableScrollFade(element.querySelector<HTMLElement>('.table-scroll-fade')!);
}
