/**
 * Grid Simulation tab. Rendering only; simulation runs through the grid
 * strategy and the backtesting engine.
 */

import { runBacktest } from '../../core/backtest/engine';
import { gridStrategy } from '../../core/strategies';
import type { Timeframe } from '../../core/types';
import type { ActiveDataSource } from '../dataSource';
import { lineChartSvg } from '../charts';
import { escapeHtml, formatPct, formatPrice, signClass, tieredPriceHtml } from '../format';

const CANDLE_LIMIT = 300;

/** Plain SVG polyline of the simulated equity curve — same shape as
 * validationView's own private helper (small enough that sharing it isn't
 * worth coupling two independent tool screens together). Grid previously
 * showed five numbers and nothing else, the only backtest-style tool in the
 * app with no visual result at all despite running a full time-series
 * simulation to get them. */
function equityCurveSvg(curve: readonly { timestamp: number; equity: number }[]): string {
  if (curve.length < 2) return '';
  const first = curve[0]!.equity;
  const last = curve[curve.length - 1]!.equity;
  return lineChartSvg(
    curve.map((p) => ({ timestamp: p.timestamp, value: p.equity })),
    {
      lineClass: last >= first ? 'equity-line-up' : 'equity-line-down',
      ariaLabel: `Simulated equity curve from ${formatPrice(first)} to ${formatPrice(last)}`,
    },
  );
}

export function renderGridView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2 class="view-title">Grid Simulation</h2>
    <p class="view-sub">
      Buys fixed amounts as price falls through grid levels and sells them as it
      recovers. Works in ranges; loses in sustained downtrends — the simulation
      shows both honestly.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="grid-symbol">
            ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
          </select>
        </label>
        <label class="control">Timeframe
          <select id="grid-timeframe">
            <option value="1h" selected>1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </label>
        <label class="control">Levels
          <input id="grid-levels" type="number" value="8" min="2" max="50" step="1" />
        </label>
        <label class="control">Amount per level
          <input id="grid-amount" type="number" value="1000" min="10" step="10" />
        </label>
        <label class="control">Initial cash
          <input id="grid-cash" type="number" value="10000" min="100" step="100" />
        </label>
        <button class="primary" id="grid-run">Simulate</button>
      </div>
      <div class="status-line" id="grid-status"></div>
    </section>
    <section class="block">
      <!-- Found in the 2026-09-06 readiness/kill-switch audit: unlike every
           account screen (Home, Crypto, Stocks, Portfolio), this tool's
           results carried no SIMULATED tag at all despite being a pure
           historical backtest with no live money behind it whatsoever. -->
      <div class="block-head"><h2>Results <span class="tag-sim">SIMULATED</span></h2></div>
      <div id="grid-results"><div class="empty">Configure a grid above and press Simulate to see results.</div></div>
    </section>
  `;

  const runButton = container.querySelector<HTMLButtonElement>('#grid-run')!;
  const status = container.querySelector<HTMLElement>('#grid-status')!;
  const results = container.querySelector<HTMLElement>('#grid-results')!;

  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    results.innerHTML = '';
    const symbol = container.querySelector<HTMLSelectElement>('#grid-symbol')!.value;
    const timeframe = container.querySelector<HTMLSelectElement>('#grid-timeframe')!
      .value as Timeframe;
    const levels = Number(container.querySelector<HTMLInputElement>('#grid-levels')!.value);
    const amountPerLevel = Number(container.querySelector<HTMLInputElement>('#grid-amount')!.value);
    const initialCash = Number(container.querySelector<HTMLInputElement>('#grid-cash')!.value);

    status.innerHTML = `<span class="loading-inline"><span class="spinner sm"></span>Loading ${escapeHtml(symbol)} history…</span>`;
    try {
      const candles = await data.source.getCandles(symbol, timeframe, CANDLE_LIMIT);
      if (!candles.ok) {
        status.innerHTML = `<span class="error-line">${escapeHtml(candles.error)}</span>`;
        return;
      }
      if (candles.value.length === 0) {
        status.innerHTML = '<span class="error-line">No history available for this market yet.</span>';
        return;
      }
      // Grid bounds from observed range — a starting point the user can reason about.
      const lows = candles.value.map((c) => c.low);
      const highs = candles.value.map((c) => c.high);
      const lowerBound = Math.min(...lows);
      const upperBound = Math.max(...highs);

      const strategy = gridStrategy({ lowerBound, upperBound, levels, amountPerLevel });
      const result = runBacktest(candles.value, strategy, { initialCash });

      status.textContent =
        `${symbol} · grid ${formatPrice(lowerBound)} – ${formatPrice(upperBound)} · ` +
        `${candles.value.length} candles (${timeframe}) · source: ${data.source.name}`;
      // Headline first (equity + return, the two numbers the simulation was
      // actually run to answer), then the curve that got them there, then
      // the supporting metrics — a hierarchy, not five equally-weighted
      // boxes with no visual result behind any of them.
      results.innerHTML = `
        <div class="stat-row">
          <div class="stat-tile"><div class="stat-tile-value ${signClass(result.totalReturnPct)}">${tieredPriceHtml(formatPrice(result.finalEquity))}</div>
            <div class="stat-tile-label">Final equity</div></div>
          <div class="stat-tile"><div class="stat-tile-value ${signClass(result.totalReturnPct)}">${formatPct(result.totalReturnPct)}</div>
            <div class="stat-tile-label">Return</div></div>
        </div>
        ${equityCurveSvg(result.equityCurve)}
        <div class="stat-row">
          <div class="stat-tile"><div class="stat-tile-value">${result.maxDrawdownPct.toFixed(2)}%</div>
            <div class="stat-tile-label">Max drawdown</div></div>
          <div class="stat-tile"><div class="stat-tile-value">${result.stats.tradeCount}</div>
            <div class="stat-tile-label">Closed trades</div></div>
          <div class="stat-tile"><div class="stat-tile-value">${result.stats.winRatePct === null ? '—' : `${result.stats.winRatePct.toFixed(0)}%`}</div>
            <div class="stat-tile-label">Win rate</div></div>
        </div>
      `;
    } catch (cause) {
      status.innerHTML = `<span class="error-line">Simulation failed: ${escapeHtml(String(cause))}</span>`;
    } finally {
      runButton.disabled = false;
    }
  });
}
