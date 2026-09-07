/**
 * Prop-constraint replay harness — extends `validateAutopilot.mts`'s replay
 * pattern (same faithful `PaperAutoPilot` replay: real risk engine, real
 * exit logic, real no-look-ahead movable clock) WITHOUT modifying that
 * file. The one addition: at each cycle, in addition to the close-based
 * equity `PaperAutoPilot` itself decides on (unchanged — the strategy still
 * only ever sees closes), this ALSO mark-to-markets the open positions at
 * the bar's HIGH and LOW to expose the account's floating-equity extremes a
 * prop firm's risk engine would see, plus a ruleset-independent trade-
 * activity ledger (notional opened/closed/held) that `propConstraintReplay.
 * mts` re-prices per ruleset via `feesForBar` — so the (expensive) strategy
 * simulation runs once per exposure/position config, not once per ruleset.
 */

import { PaperAutoPilot, AUTOPILOT_MAX_RSI_FOR_LONG, AUTOPILOT_MIN_CONFIDENCE, AUTOPILOT_TRAILING } from '../../src/core/autopilot/paperAutoPilot';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import { MemoryStore } from '../../src/core/data/storage';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import { drawdownBreached } from '../../src/core/risk/drawdownBreaker';
import type { RiskLimits } from '../../src/core/risk/riskEngine';
import type { Candle, Timeframe } from '../../src/core/types';
import { ok } from '../../src/core/types';

/** One bar of the account's floating-equity extremes plus raw trade activity,
 * ruleset-independent — `feesForBar` (propRiskKernel.ts) turns this into a
 * ruleset-specific `PropBar` for `evaluatePropRun`. */
export interface PropReplayBar {
  readonly timestamp: number;
  readonly equityLow: number;
  readonly equityHigh: number;
  readonly equityClose: number;
  readonly openedNotional: number;
  readonly closedNotional: number;
  readonly openNotionalAfterBar: number;
  readonly barHours: number;
}

export interface PropReplayRunResult {
  readonly bars: PropReplayBar[];
  readonly startTimestamp: number;
  readonly endTimestamp: number;
}

export interface PropReplayParams {
  readonly symbols: readonly string[];
  readonly h1: ReadonlyMap<string, readonly Candle[]>;
  readonly h4: ReadonlyMap<string, readonly Candle[]>;
  /** Chronological, no-look-ahead clock ticks for this one rolling run. */
  readonly timestamps: readonly number[];
  readonly initialCash: number;
  readonly riskLimits: RiskLimits;
  readonly entryTf: Timeframe;
  readonly confirmationTf: Timeframe;
  readonly costRate: number;
  readonly ddBreakerPct: number;
  /** Hours per entry-timeframe bar (1 for '1h') — prorates the daily swap charge. */
  readonly barHours: number;
}

export async function runPropReplay(params: PropReplayParams): Promise<PropReplayRunResult> {
  let clock = 0;
  const source: MarketDataSource = {
    name: 'historical-replay',
    getInstruments: async () => ok(params.symbols.map((s) => ({ symbol: s, base: s, quote: 'EUR' }))),
    getCandles: async (symbol, timeframe, limit) => {
      const series = (timeframe === params.confirmationTf ? params.h4 : params.h1).get(symbol) ?? [];
      return ok(series.filter((c) => c.timestamp <= clock).slice(-limit));
    },
  };

  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: params.initialCash, baseCurrency: 'EUR' });

  let peak = params.initialCash;
  let equity = params.initialCash;

  const pilot = new PaperAutoPilot({
    source,
    symbols: params.symbols,
    timeframe: params.entryTf,
    confirmationTimeframe: params.confirmationTf,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0,
    costRate: params.costRate,
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    trailing: AUTOPILOT_TRAILING,
    riskLimits: params.riskLimits,
    haltNewEntries: () =>
      drawdownBreached({ peakEquity: peak, currentEquity: equity, maxDrawdownPct: params.ddBreakerPct }),
  });

  const bars: PropReplayBar[] = [];

  for (const timestamp of params.timestamps) {
    clock = timestamp;

    // `CycleResult.closed` carries no quantity (the autopilot only ever
    // fully closes — see paperAutoPilot.ts), so capture pre-cycle quantities
    // by id to size the exit-side fee below.
    const preQuantityById = new Map(portfolio.openPositions().map((p) => [p.id, p.quantity]));

    const cycle = await pilot.runCycleOnce(timestamp);

    const lowPrices: Record<string, number> = {};
    const highPrices: Record<string, number> = {};
    const closePrices: Record<string, number> = {};
    for (const position of portfolio.openPositions()) {
      const series = params.h1.get(position.symbol) ?? [];
      for (let i = series.length - 1; i >= 0; i--) {
        const c = series[i]!;
        if (c.timestamp <= timestamp) {
          lowPrices[position.symbol] = c.low;
          highPrices[position.symbol] = c.high;
          closePrices[position.symbol] = c.close;
          break;
        }
      }
    }

    // Worst/best-case extremes this bar (all open positions marked at the
    // bar's low/high simultaneously — the standard conservative bound; the
    // strategy's own decisions above are unaffected, they only ever saw
    // closes). Close-based equity is exactly what the production runner
    // computes (mirrors validateAutopilot.mts).
    const equityLow = portfolio.snapshot(lowPrices, timestamp).equity;
    const equityHigh = portfolio.snapshot(highPrices, timestamp).equity;
    equity = portfolio.snapshot(closePrices, timestamp).equity;
    peak = Math.max(peak, equity);

    let openedNotional = 0;
    for (const opened of cycle.opened) openedNotional += opened.quantity * opened.entry;

    let closedNotional = 0;
    for (const closed of cycle.closed) {
      const preQty = closed.id !== undefined ? preQuantityById.get(closed.id) : undefined;
      if (preQty !== undefined) closedNotional += preQty * closed.price;
    }

    const openNotionalAfterBar = portfolio
      .openPositions()
      .reduce((sum, p) => sum + p.quantity * (closePrices[p.symbol] ?? p.entryPrice), 0);

    bars.push({
      timestamp,
      equityLow,
      equityHigh,
      equityClose: equity,
      openedNotional,
      closedNotional,
      openNotionalAfterBar,
      barHours: params.barHours,
    });
  }

  return {
    bars,
    startTimestamp: params.timestamps[0] ?? 0,
    endTimestamp: params.timestamps[params.timestamps.length - 1] ?? 0,
  };
}
