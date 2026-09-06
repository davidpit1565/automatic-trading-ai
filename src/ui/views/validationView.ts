/**
 * Validation tab — Stage 3.5.
 *
 * Rendering only: walk-forward analysis, cost modelling, performance
 * metrics, and the robustness verdict all come from the validation engine.
 * The equity curve is drawn as a plain SVG polyline from engine output.
 */

import { assessRobustness, type RobustnessAssessment } from '../../core/validation/robustness';
import {
  optimizingTrendFactory,
  walkForward,
  type WalkForwardReport,
} from '../../core/validation/walkForward';
import type { EquityPoint } from '../../core/backtest/metrics';
import type { PerformanceReport } from '../../core/validation/performance';
import type { Timeframe } from '../../core/types';
import { lineChartSvg } from '../charts';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass, tieredPriceHtml } from '../format';

const CANDLE_LIMIT = 600;
const TRAIN_SIZE = 150;
const TEST_SIZE = 75;
const INITIAL_CASH = 10_000;

/** Small, honest grid — enough to demonstrate optimisation without dredging. */
const TREND_GRID = [
  { fastPeriod: 5, slowPeriod: 20 },
  { fastPeriod: 10, slowPeriod: 30 },
  { fastPeriod: 10, slowPeriod: 50 },
  { fastPeriod: 20, slowPeriod: 60 },
];

export function renderValidationView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = `
    <h2 class="view-title">Validation</h2>
    <p class="view-sub">
      Walk-forward analysis: strategy parameters are chosen on a rolling training window,
      then judged on the unseen candles that follow — with fees, spread, and slippage
      included. Out-of-sample numbers are the ones that matter.
    </p>
    <section class="block">
      <div class="block-head"><h2>Configure</h2></div>
      <div class="controls">
        <label class="control">Market
          <select id="val-symbol">
            ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
          </select>
        </label>
        <label class="control">Timeframe
          <select id="val-timeframe">
            <option value="1h" selected>1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </label>
        <label class="control">Fee %
          <input id="val-fee" type="number" value="0.1" min="0" max="2" step="0.05" />
        </label>
        <label class="control">Spread %
          <input id="val-spread" type="number" value="0.1" min="0" max="2" step="0.05" />
        </label>
        <label class="control">Slippage %
          <input id="val-slippage" type="number" value="0.05" min="0" max="2" step="0.05" />
        </label>
        <button class="primary" id="val-run">Run walk-forward</button>
      </div>
      <div class="status-line" id="val-status"></div>
    </section>
    <div id="val-results"><div class="empty">Configure the walk-forward above and press Run to see results.</div></div>
    <p class="disclaimer">
      Validation measures how a strategy behaved on unseen historical data with realistic
      costs. It cannot predict the future and is not financial advice.
    </p>
  `;

  const runButton = container.querySelector<HTMLButtonElement>('#val-run')!;
  const status = container.querySelector<HTMLElement>('#val-status')!;
  const results = container.querySelector<HTMLElement>('#val-results')!;

  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    results.innerHTML = '';
    const symbol = container.querySelector<HTMLSelectElement>('#val-symbol')!.value;
    const timeframe = container.querySelector<HTMLSelectElement>('#val-timeframe')!.value as Timeframe;
    const feeRate = Number(container.querySelector<HTMLInputElement>('#val-fee')!.value) / 100;
    const spreadPct = Number(container.querySelector<HTMLInputElement>('#val-spread')!.value) / 100;
    const slippagePct = Number(container.querySelector<HTMLInputElement>('#val-slippage')!.value) / 100;

    status.innerHTML = `<span class="loading-inline"><span class="spinner sm"></span>Loading ${CANDLE_LIMIT} ${timeframe} candles for ${escapeHtml(symbol)}…</span>`;
    try {
      const candles = await data.source.getCandles(symbol, timeframe, CANDLE_LIMIT);
      if (!candles.ok) {
        status.innerHTML = `<span class="error-line">${escapeHtml(candles.error)}</span>`;
        return;
      }
      status.innerHTML = `<span class="loading-inline"><span class="spinner sm"></span>Running walk-forward on ${candles.value.length} candles…</span>`;
      const backtest = {
        initialCash: INITIAL_CASH,
        feeRate,
        spreadPct,
        slippagePct,
        executionDelayCandles: 1,
      };
      const report = walkForward(candles.value, optimizingTrendFactory(TREND_GRID, backtest), {
        trainSize: TRAIN_SIZE,
        testSize: TEST_SIZE,
        timeframe,
        backtest,
      });
      const robustness = assessRobustness({
        avgTrainReturnPct: report.aggregate.avgTrainReturnPct,
        avgTestReturnPct: report.aggregate.avgTestReturnPct,
        avgTrainSharpe: report.aggregate.avgTrainSharpe,
        avgTestSharpe: report.aggregate.avgTestSharpe,
        totalTestTrades: report.aggregate.totalTestTrades,
        foldCount: report.folds.length,
        avgTestWinRatePct: report.aggregate.avgTestWinRatePct,
        parameterSpread: parameterSpreadOf(report),
      });
      // Two lines, not one continuous "·"-joined run-on sentence — packing
      // symbol/fold-shape/three cost figures/source onto a single line wrapped
      // mid-word on a phone (the delay clause split apart mid-phrase); split
      // it the same way Monitoring's own run-on status line was split in an
      // earlier pass. Both substrings still land inside #val-status for
      // existing assertions (e.g. the 'spread' check below).
      status.innerHTML =
        `<div>${escapeHtml(symbol)} · ${report.folds.length} folds (train ${TRAIN_SIZE} / test ${TEST_SIZE}) · source: ${escapeHtml(data.source.name)}</div>` +
        `<div>costs: ${(feeRate * 100).toFixed(2)}% fee, ${(spreadPct * 100).toFixed(2)}% spread, ` +
        `${(slippagePct * 100).toFixed(2)}% slippage, 1-candle delay</div>`;
      renderReport(results, report, robustness);
    } catch (cause) {
      status.innerHTML = `<span class="error-line">Validation failed: ${escapeHtml(String(cause))}</span>`;
    } finally {
      runButton.disabled = false;
    }
  });
}

/** Chosen-vs-median grid returns, averaged over folds (engine data only). */
function parameterSpreadOf(report: WalkForwardReport) {
  const spreads = report.folds
    .map((fold) => {
      if (!fold.diagnostics) return null;
      const returns = fold.diagnostics.evaluated.map((e) => e.returnPct).sort((a, b) => a - b);
      const median = returns[Math.floor(returns.length / 2)]!;
      const chosen = fold.diagnostics.evaluated.find((e) => e.params === fold.diagnostics!.chosen);
      return chosen ? { chosen: chosen.returnPct, median } : null;
    })
    .filter((s): s is { chosen: number; median: number } => s !== null);
  if (spreads.length === 0) return undefined;
  return {
    chosenReturnPct: spreads.reduce((sum, s) => sum + s.chosen, 0) / spreads.length,
    medianReturnPct: spreads.reduce((sum, s) => sum + s.median, 0) / spreads.length,
  };
}

function renderReport(
  container: HTMLElement,
  report: WalkForwardReport,
  robustness: RobustnessAssessment,
): void {
  const a = report.aggregate;
  // Degradation is inverted vs. every other stat-tile here: it's "share of
  // in-sample return that did NOT survive out of sample" (see its own
  // computation, `(1 - test/train) * 100`, in walkForward.ts), so a bigger
  // POSITIVE number is worse, not better — the opposite of what green/red
  // means on every neighbouring tile. A plain signClass() would color a
  // severe "+107%" green. Sharpe, by contrast, is a standard signed
  // risk-adjusted-return metric — negative is unambiguously bad, so it can
  // reuse the same up/down convention as the return tiles beside it.
  const degradationClass =
    a.degradationPct === null || a.degradationPct === 0
      ? ''
      : a.degradationPct > 0
        ? 'negative'
        : 'positive';
  container.innerHTML = `
    <div class="verdict-panel verdict-${robustness.verdict}">
      <div class="signal-title">Verdict: ${verdictLabel(robustness.verdict)}</div>
      <p>${escapeHtml(robustness.explanation)}</p>
      ${
        robustness.flags.length > 0
          ? `<ul class="scan-warnings">${robustness.flags
              .map((f) => `<li>⚠ <strong>${f.kind}</strong>: ${escapeHtml(f.detail)}</li>`)
              .join('')}</ul>`
          : ''
      }
    </div>

    <!-- Same fix as gridView.ts/backtestView.ts, same audit: a walk-forward
         backtest with no SIMULATED tag anywhere, inconsistent with every
         account screen in the app. -->
    <div class="block-head"><h2>Out-of-sample equity (all folds, costs included) <span class="tag-sim">SIMULATED</span></h2></div>
    ${equityCurveSvg(report.oosEquityCurve)}

    <div class="block-head"><h2>Training vs unseen data</h2></div>
    <div class="stat-row">
      <div class="stat-tile"><div class="stat-tile-value ${signClass(a.avgTrainReturnPct)}">${formatPct(a.avgTrainReturnPct)}</div>
        <div class="stat-tile-label">Avg return (train)</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${signClass(a.avgTestReturnPct)}">${formatPct(a.avgTestReturnPct)}</div>
        <div class="stat-tile-label">Avg return (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${degradationClass}">${a.degradationPct === null ? '—' : formatPct(a.degradationPct, 0)}</div>
        <div class="stat-tile-label">Degradation</div></div>
      <div class="stat-tile"><div class="stat-tile-value ${signClass(a.avgTestSharpe)}">${a.avgTestSharpe === null ? '—' : a.avgTestSharpe.toFixed(2)}</div>
        <div class="stat-tile-label">Sharpe (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${a.avgTestWinRatePct === null ? '—' : formatPct(a.avgTestWinRatePct, 0)}</div>
        <div class="stat-tile-label">Win rate (unseen)</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${a.totalTestTrades}</div>
        <div class="stat-tile-label">OOS trades</div></div>
    </div>

    <div class="block-head"><h2>Per-fold results (${escapeHtml(report.strategyName)})</h2></div>
    <div class="table-scroll-fade">
    <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          <th>Fold</th><th>Params</th><th>Train return</th><th>Unseen return</th>
          <th>Unseen trades</th><th>Win rate</th><th>Profit factor</th>
          <th>Expectancy</th><th>Max DD</th><th>Avg hold</th>
        </tr>
      </thead>
      <tbody>
        ${report.folds
          .map(
            (fold) => `<tr>
              <td>${fold.foldIndex + 1}</td>
              <td>${escapeHtml(fold.chosenParams ?? '—')}</td>
              <td class="${signClass(fold.train.totalReturnPct)}">${formatPct(fold.train.totalReturnPct)}</td>
              <td class="${signClass(fold.test.totalReturnPct)}">${formatPct(fold.test.totalReturnPct)}</td>
              <td>${fold.test.tradeCount}</td>
              <td>${fold.test.winRatePct === null ? '—' : formatPct(fold.test.winRatePct, 0)}</td>
              <td class="${fold.test.profitFactor === null ? '' : fold.test.profitFactor >= 1 ? 'positive' : 'negative'}">${fold.test.profitFactor === null ? '—' : fold.test.profitFactor.toFixed(2)}</td>
              <td class="${signClass(fold.test.expectancy)}">${fold.test.expectancy === null ? '—' : tieredPriceHtml(formatPrice(fold.test.expectancy))}</td>
              <td>${formatPct(-fold.test.maxDrawdownPct)}</td>
              <td>${formatHold(fold.test.avgHoldingTimeMs)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    </div>
    </div>
  `;
  initTableScrollFade(container.querySelector<HTMLElement>('.table-scroll-fade')!);
}

/** Hints that the per-fold table scrolls further right than the visible
 * edge shows — small enough that sharing it with backtestView.ts's own
 * identical helper isn't worth coupling two independent tool screens
 * together (same reasoning this file's own equityCurveSvg comment gives). */
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

function verdictLabel(verdict: RobustnessAssessment['verdict']): string {
  const labels = {
    robust: 'ROBUST — no checks triggered',
    caution: 'CAUTION — treat with scepticism',
    overfitted: 'OVERFITTED — do not trust this configuration',
    'insufficient-data': 'INSUFFICIENT DATA — no conclusion possible',
  } as const;
  return labels[verdict];
}

function formatHold(ms: number | null): string {
  if (ms === null) return '—';
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/** Plain SVG polyline of the out-of-sample equity curve (base 100). */
function equityCurveSvg(curve: readonly EquityPoint[]): string {
  if (curve.length < 2) return '<p class="status-line">Not enough points for a curve.</p>';
  const last = curve[curve.length - 1]!.equity;
  const chart = lineChartSvg(
    curve.map((p) => ({ timestamp: p.timestamp, value: p.equity })),
    {
      lineClass: last >= 100 ? 'equity-line-up' : 'equity-line-down',
      ariaLabel: `Out-of-sample equity curve from ${curve[0]!.equity.toFixed(1)} to ${last.toFixed(1)}`,
    },
  );
  return `${chart}<p class="status-line">Start 100 → end ${last.toFixed(1)} (${formatPct(last - 100)})</p>`;
}
