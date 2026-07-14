/**
 * Backtesting Lab tab. Rendering + form handling only; all simulation runs
 * through the backtesting engine and strategy modules.
 */

import { compareStrategies, type BacktestResult } from '../../core/backtest/engine';
import { buyAndHoldStrategy, dcaStrategy, trendStrategy } from '../../core/strategies';
import type { Timeframe } from '../../core/types';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass } from '../format';

const TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d'];
const CANDLE_LIMIT = 300;

export function renderBacktestView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2>Backtesting Lab</h2>
    <p class="status-line">
      Compare strategies over the same history, fees included, liquidation at the end.
      Past performance never guarantees future results.
    </p>
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
    <div id="bt-results"></div>
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

    status.textContent = `Loading ${CANDLE_LIMIT} ${timeframe} candles for ${symbol}…`;
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
          <td>${escapeHtml(r.strategyName)}</td>
          <td>${formatPrice(r.finalEquity)}</td>
          <td class="${signClass(r.totalReturnPct)}">${formatPct(r.totalReturnPct)}</td>
          <td>${formatPct(-r.maxDrawdownPct)}</td>
          <td>${r.stats.tradeCount}</td>
          <td>${r.stats.winRatePct === null ? '—' : formatPct(r.stats.winRatePct, 0)}</td>
          <td>${formatPrice(r.feesPaid)}</td>
        </tr>`,
        )
        .join('')}
    </tbody>
  `;
  container.appendChild(table);
}
