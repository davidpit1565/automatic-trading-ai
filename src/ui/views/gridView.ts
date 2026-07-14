/**
 * Grid Simulation tab. Rendering only; simulation runs through the grid
 * strategy and the backtesting engine.
 */

import { runBacktest } from '../../core/backtest/engine';
import { gridStrategy } from '../../core/strategies';
import type { Timeframe } from '../../core/types';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass } from '../format';

const CANDLE_LIMIT = 300;

export function renderGridView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2>Grid Simulation</h2>
    <p class="status-line">
      Buys fixed amounts as price falls through grid levels and sells them as it
      recovers. Works in ranges; loses in sustained downtrends — the simulation
      shows both honestly.
    </p>
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
    <div id="grid-results"></div>
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

    status.textContent = `Loading ${symbol} history…`;
    try {
      const candles = await data.source.getCandles(symbol, timeframe, CANDLE_LIMIT);
      if (!candles.ok) {
        status.innerHTML = `<span class="error-line">${escapeHtml(candles.error)}</span>`;
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
      results.innerHTML = `
        <div class="result-cards">
          <div class="stat-card"><div class="stat-label">Final equity</div>
            <div class="stat-value">${formatPrice(result.finalEquity)}</div></div>
          <div class="stat-card"><div class="stat-label">Return</div>
            <div class="stat-value ${signClass(result.totalReturnPct)}">${formatPct(result.totalReturnPct)}</div></div>
          <div class="stat-card"><div class="stat-label">Max drawdown</div>
            <div class="stat-value">${formatPct(-result.maxDrawdownPct)}</div></div>
          <div class="stat-card"><div class="stat-label">Closed trades</div>
            <div class="stat-value">${result.stats.tradeCount}</div></div>
          <div class="stat-card"><div class="stat-label">Win rate</div>
            <div class="stat-value">${result.stats.winRatePct === null ? '—' : formatPct(result.stats.winRatePct, 0)}</div></div>
        </div>
      `;
    } catch (cause) {
      status.innerHTML = `<span class="error-line">Simulation failed: ${escapeHtml(String(cause))}</span>`;
    } finally {
      runButton.disabled = false;
    }
  });
}
