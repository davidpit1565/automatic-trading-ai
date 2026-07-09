/**
 * Market Scan tab.
 *
 * Rendering only: all analysis comes from `scanMarket` in the Monitoring
 * layer. Rows are clickable and expand into the component breakdown that
 * explains the score, plus any warnings — transparency over certainty.
 */

import { scanMarket, type MarketScan, type ScanResult } from '../../core/scan/marketScanner';
import {
  evaluateScan,
  positionSize,
  MAX_CONFIDENCE,
  type SignalDecision,
} from '../../core/signal/signalEngine';
import type { Timeframe } from '../../core/types';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatNumber, formatPct, formatPrice, signClass } from '../format';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];
const SCAN_SYMBOL_LIMIT = 12;
const SCAN_CANDLES = 150;

/** Illustrative sizing example shown with each opportunity, clearly labelled. */
const EXAMPLE_EQUITY = 10_000;
const EXAMPLE_RISK_PCT = 1;
const EXAMPLE_MAX_POSITION_PCT = 25;

export function renderMarketScanView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2>Market Scan</h2>
    <p class="status-line">
      Scores each market from −100 (strong bearish evidence) to +100 (strong bullish
      evidence) using trend, momentum, MACD, stochastic and volume. Click a row for the
      full breakdown.
    </p>
    <div class="controls">
      <label class="control">Timeframe
        <select id="scan-timeframe">
          ${TIMEFRAMES.map((tf) => `<option value="${tf}" ${tf === '1h' ? 'selected' : ''}>${tf}</option>`).join('')}
        </select>
      </label>
      <button class="primary" id="scan-run">Run scan</button>
    </div>
    <div class="status-line" id="scan-status"></div>
    <div id="scan-results"></div>
    <p class="disclaimer">
      Scores measure current technical evidence only. They are not predictions and not
      financial advice.
    </p>
  `;

  const runButton = container.querySelector<HTMLButtonElement>('#scan-run')!;
  const timeframeSelect = container.querySelector<HTMLSelectElement>('#scan-timeframe')!;
  const status = container.querySelector<HTMLElement>('#scan-status')!;
  const results = container.querySelector<HTMLElement>('#scan-results')!;

  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    const timeframe = timeframeSelect.value as Timeframe;
    status.textContent = `Scanning ${Math.min(data.instruments.length, SCAN_SYMBOL_LIMIT)} markets on ${timeframe} (${data.source.name})…`;
    results.innerHTML = '';
    try {
      const symbols = data.instruments.slice(0, SCAN_SYMBOL_LIMIT).map((i) => i.symbol);
      const scan = await scanMarket(data.source, symbols, timeframe, SCAN_CANDLES);
      status.textContent = `Scanned ${scan.results.length} markets on ${timeframe} · source: ${data.source.name}`;
      renderScanTable(results, scan);
    } catch (cause) {
      status.textContent = '';
      results.innerHTML = `<p class="error-line">Scan failed: ${escapeHtml(String(cause))}</p>`;
    } finally {
      runButton.disabled = false;
    }
  });
}

function renderScanTable(container: HTMLElement, scan: MarketScan): void {
  if (scan.results.length === 0) {
    container.innerHTML = '<p class="error-line">No markets could be scanned.</p>';
    renderFailures(container, scan);
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Market</th>
        <th>Price</th>
        <th>Change</th>
        <th>RSI</th>
        <th>ADX</th>
        <th>Rel. vol</th>
        <th>Score</th>
        <th>Signal</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');

  for (const result of scan.results) {
    const row = document.createElement('tr');
    row.className = 'scan-row';
    row.setAttribute('aria-expanded', 'false');
    row.innerHTML = `
      <td>${escapeHtml(result.symbol)}</td>
      <td>${formatPrice(result.snapshot.price)}</td>
      <td class="${signClass(result.snapshot.changePct)}">${formatPct(result.snapshot.changePct)}</td>
      <td>${formatNumber(result.snapshot.rsi)}</td>
      <td>${formatNumber(result.snapshot.adx)}</td>
      <td>${result.snapshot.relativeVolume === null ? '—' : `${result.snapshot.relativeVolume.toFixed(2)}×`}</td>
      <td class="${signClass(result.score)}">${result.score.toFixed(0)}</td>
      <td>${temperatureBadge(result)}</td>
    `;

    const detail = buildDetailRow(result);
    detail.hidden = true;
    row.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      row.classList.toggle('expanded', !detail.hidden);
      row.setAttribute('aria-expanded', String(!detail.hidden));
    });

    tbody.appendChild(row);
    tbody.appendChild(detail);
  }

  table.appendChild(tbody);
  container.appendChild(table);
  renderFailures(container, scan);
}

function temperatureBadge(result: ScanResult): string {
  const labels = { hot: 'HOT', cold: 'COLD', neutral: 'NEUTRAL' } as const;
  return `<span class="badge badge-${result.temperature}">${labels[result.temperature]}</span>`;
}

function buildDetailRow(result: ScanResult): HTMLTableRowElement {
  const detail = document.createElement('tr');
  detail.className = 'scan-detail';
  const componentsHtml = result.components
    .map(
      (component) => `
        <div class="scan-component">
          <div class="label">${escapeHtml(component.label)}</div>
          <div class="detail">${escapeHtml(component.detail)}</div>
          <div class="contribution ${signClass(component.contribution)}">
            ${component.contribution >= 0 ? '+' : ''}${component.contribution.toFixed(1)} pts
          </div>
        </div>`,
    )
    .join('');
  const warningsHtml =
    result.warnings.length > 0
      ? `<ul class="scan-warnings">${result.warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('')}</ul>`
      : '';
  const s = result.snapshot;
  detail.innerHTML = `
    <td colspan="8">
      <div class="scan-detail-grid">${componentsHtml}</div>
      ${warningsHtml}
      <p class="status-line">
        ATR ${formatNumber(s.atrPct, 2)}% · Bollinger %B ${formatNumber(s.percentB, 2)} ·
        bandwidth ${s.bollingerBandwidth === null ? '—' : (s.bollingerBandwidth * 100).toFixed(1) + '%'} ·
        +DI ${formatNumber(s.plusDi)} / −DI ${formatNumber(s.minusDi)} ·
        Stoch %D ${formatNumber(s.stochasticD)} ·
        based on ${result.candleCount} candles (${result.timeframe})
      </p>
      ${signalPanelHtml(evaluateScan(result))}
    </td>
  `;
  return detail;
}

/** Render the Signal Engine's decision — opportunity plan or explained pass. */
function signalPanelHtml(decision: SignalDecision): string {
  if (decision.kind === 'rejected') {
    const reasons =
      decision.reasons.length > 0
        ? `<ul>${decision.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
        : '';
    return `
      <div class="signal-panel signal-rejected">
        <div class="signal-title">Signal Engine: no qualifying setup</div>
        ${reasons}
      </div>
    `;
  }

  const o = decision.opportunity;
  const sizing = positionSize({
    accountEquity: EXAMPLE_EQUITY,
    riskPerTradePct: EXAMPLE_RISK_PCT,
    entry: o.levels.entry,
    stopLoss: o.levels.stopLoss,
    maxPositionPct: EXAMPLE_MAX_POSITION_PCT,
  });
  const sizingHtml = sizing.ok
    ? `<div class="signal-sizing">
         Example sizing (${EXAMPLE_RISK_PCT}% risk on a ${formatPrice(EXAMPLE_EQUITY)} paper account):
         ${sizing.value.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} units
         ≈ ${formatPrice(sizing.value.notional)} notional, ${formatPrice(sizing.value.riskAmount)} at risk
         ${sizing.value.cappedByMaxPosition ? ` (capped at ${EXAMPLE_MAX_POSITION_PCT}% of equity)` : ''}
       </div>`
    : '';

  return `
    <div class="signal-panel signal-opportunity">
      <div class="signal-title">
        Signal Engine: LONG setup · confidence ${o.confidence.toFixed(0)}/${MAX_CONFIDENCE}
      </div>
      <div class="signal-levels">
        <span>Entry ≈ ${formatPrice(o.levels.entry)}</span>
        <span>Stop loss ${formatPrice(o.levels.stopLoss)}</span>
        <span>Take profit ${formatPrice(o.levels.takeProfit)}</span>
        <span>R/R ${o.levels.riskReward.toFixed(1)}</span>
      </div>
      <p class="signal-explanation">${escapeHtml(o.explanation)}</p>
      ${sizingHtml}
    </div>
  `;
}

function renderFailures(container: HTMLElement, scan: MarketScan): void {
  if (scan.failures.length === 0) return;
  const failures = document.createElement('div');
  failures.className = 'scan-failures';
  failures.innerHTML = `
    <strong>Not scanned (${scan.failures.length}):</strong>
    ${scan.failures.map((f) => `${escapeHtml(f.symbol)} — ${escapeHtml(f.reason)}`).join('; ')}
  `;
  container.appendChild(failures);
}
