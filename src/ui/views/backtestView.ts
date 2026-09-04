/**
 * Backtesting Lab tab. Rendering + form handling only; all simulation runs
 * through the backtesting engine and strategy modules.
 */

import { compareStrategies, type BacktestResult } from '../../core/backtest/engine';
import { buyAndHoldStrategy, dcaStrategy, trendStrategy } from '../../core/strategies';
import type { Timeframe } from '../../core/types';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass, tieredPriceHtml } from '../format';

const TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d'];
const CANDLE_LIMIT = 300;

export function renderBacktestView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2 class="view-title">Backtesting Lab</h2>
    <p class="view-sub">
      Compare strategies over the same history, fees included, liquidation at the end.
      Past performance never guarantees future results.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="bt-symbol">
            ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
          </select>
        </label>
        <label class="control">Timeframe
          <select id="bt-timeframe">
            ${TIMEFRAMES.map((tf) => `<option value="${tf}" ${tf === '1d' ? 'selected' : ''}>${tf}</option>`).join('')}
          </select>
        </label>
        <label class="control">Initial cash
          <input id="bt-cash" type="number" value="10000" min="100" step="100" />
        </label>
        <label class="control">Fee %
          <input id="bt-fee" type="number" value="0.1" min="0" max="5" step="0.05" />
        </label>
        <div class="control-checkboxes">
          <label><input type="checkbox" id="bt-hold" checked /> Buy &amp; Hold</label>
          <label><input type="checkbox" id="bt-dca" checked /> DCA</label>
          <label><input type="checkbox" id="bt-trend" checked /> Trend (SMA 10/30)</label>
        </div>
        <button class="primary" id="bt-run">Run backtest</button>
      </div>
      <div class="status-line" id="bt-status"></div>
    </section>
    <section class="block">
      <div class="block-head"><h2>Results</h2></div>
      <div id="bt-results"><div class="empty">Configure a backtest above and press Run to compare strategies.</div></div>
    </section>
  `;

  const runButton = container.querySelector<HTMLButtonElement>('#bt-run')!;
  const status = container.querySelector<HTMLElement>('#bt-status')!;
  const results = container.querySelector<HTMLElement>('#bt-results')!;

  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    results.innerHTML = '';
    const symbol = container.querySelector<HTMLSelectElement>('#bt-symbol')!.value;
    const timeframe = container.querySelector<HTMLSelectElement>('#bt-timeframe')!.value as Timeframe;
    const initialCash = Number(container.querySelector<HTMLInputElement>('#bt-cash')!.value);
    const feeRate = Number(container.querySelector<HTMLInputElement>('#bt-fee')!.value) / 100;

    status.innerHTML = `<span class="loading-inline"><span class="spinner sm"></span>Loading ${CANDLE_LIMIT} ${timeframe} candles for ${escapeHtml(symbol)}…</span>`;
    try {
      const candles = await data.source.getCandles(symbol, timeframe, CANDLE_LIMIT);
      if (!candles.ok) {
        status.innerHTML = `<span class="error-line">${escapeHtml(candles.error)}</span>`;
        return;
      }
      const strategies = [];
      if (container.querySelector<HTMLInputElement>('#bt-hold')!.checked) {
        strategies.push(buyAndHoldStrategy());
      }
      if (container.querySelector<HTMLInputElement>('#bt-dca')!.checked) {
        strategies.push(
          dcaStrategy({
            intervalCandles: Math.max(1, Math.floor(candles.value.length / 20)),
            amountPerPurchase: initialCash / 20,
          }),
        );
      }
      if (container.querySelector<HTMLInputElement>('#bt-trend')!.checked) {
        strategies.push(trendStrategy({ fastPeriod: 10, slowPeriod: 30 }));
      }
      if (strategies.length === 0) {
        status.innerHTML = '<span class="error-line">Select at least one strategy.</span>';
        return;
      }

      const comparison = compareStrategies(candles.value, strategies, { initialCash, feeRate });
      status.textContent = `${symbol} · ${candles.value.length} candles (${timeframe}) · source: ${data.source.name}`;
      renderComparisonTable(results, comparison);
    } catch (cause) {
      status.innerHTML = `<span class="error-line">Backtest failed: ${escapeHtml(String(cause))}</span>`;
    } finally {
      runButton.disabled = false;
    }
  });
}

function renderComparisonTable(container: HTMLElement, results: BacktestResult[]): void {
  // Highlights the top-performing strategy inline (a small badge, not a new
  // column) — the reference always calls out a "winner" rather than leaving
  // a row of equally-weighted numbers for the reader to scan and compare
  // themselves.
  const bestReturn = Math.max(...results.map((r) => r.totalReturnPct));
  const best = results.find((r) => r.totalReturnPct === bestReturn)!;
  const avgReturn = results.reduce((s, r) => s + r.totalReturnPct, 0) / results.length;

  // The at-a-glance summary the reference always opens a comparison with —
  // three plain stat-tiles, before the detailed per-strategy breakdown below
  // rather than making the reader scan a whole table just to find the
  // headline number.
  const summary = document.createElement('div');
  summary.className = 'stat-row';
  summary.innerHTML = `
    <div class="stat-tile"><div class="stat-tile-value up">${escapeHtml(best.strategyName)}</div><div class="stat-tile-label">Best strategy</div></div>
    <div class="stat-tile"><div class="stat-tile-value ${bestReturn >= 0 ? 'up' : 'down'}">${formatPct(bestReturn)}</div><div class="stat-tile-label">Best return</div></div>
    <div class="stat-tile"><div class="stat-tile-value ${avgReturn >= 0 ? 'up' : 'down'}">${formatPct(avgReturn)}</div><div class="stat-tile-label">Average return</div></div>
    <div class="stat-tile"><div class="stat-tile-value">${results.length}</div><div class="stat-tile-label">Strategies compared</div></div>
  `;

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Strategy</th>
        <th>Final equity</th>
        <th>Return</th>
        <th>Max drawdown</th>
        <th>Trades</th>
        <th>Win rate</th>
        <th>Fees paid</th>
      </tr>
    </thead>
    <tbody>
      ${results
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.strategyName)}${r.totalReturnPct === bestReturn ? ' <span class="badge badge-hot">BEST</span>' : ''}</td>
          <td>${tieredPriceHtml(formatPrice(r.finalEquity))}</td>
          <td class="${signClass(r.totalReturnPct)}">${formatPct(r.totalReturnPct)}</td>
          <td>${r.maxDrawdownPct.toFixed(2)}%</td>
          <td>${r.stats.tradeCount}</td>
          <td>${r.stats.winRatePct === null ? '—' : `${r.stats.winRatePct.toFixed(0)}%`}</td>
          <td>${tieredPriceHtml(formatPrice(r.feesPaid))}</td>
        </tr>`,
        )
        .join('')}
    </tbody>
  `;
  container.innerHTML = '';
  container.appendChild(summary);
  container.appendChild(table);
}
