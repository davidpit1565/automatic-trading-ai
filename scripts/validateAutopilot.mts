/**
 * Autopilot scoreboard — the honest one.
 *
 * Replays the REAL `PaperAutoPilot` (the class the cloud runner trades with)
 * over real Kraken history: one shared account, the actual risk limits, the
 * real exit logic. Prints the after-fee result for the production universe.
 *
 * WHY THIS EXISTS, alongside `validateStrategy.mts`:
 * `validateStrategy` and `sweepStrategy` both drive `runLivePipelineBacktest`,
 * which deliberately differs from the autopilot in ways that turn out to matter
 * a great deal (measured 2026-07-27, same 5 majors, same 720 1h candles, same
 * parameters):
 *
 *     livePipeline, per-symbol, averaged   return -0.002%  PF 0.985  3 trades
 *     PaperAutoPilot, one shared account   return -0.857%  PF 0.019  3 trades
 *
 * Same three entries, opposite verdicts. The cause is exit granularity, not
 * position sizing: livePipeline checks exits INTRABAR (low <= stop,
 * high >= target) while the autopilot only ever sees candle CLOSES. On ADA the
 * backtest booked a take-profit at 0.1584 that the robot never saw — it exited
 * at a close of 0.1529 on the trailed stop instead. With few trades, one such
 * flip moves the profit factor by a factor of fifty.
 *
 * Intrabar is the right convention for a system with resting stop/target orders
 * at the exchange. This robot has none: it polls, and acts on a close. So for
 * TUNING decisions this script is the instrument to trust, and livePipeline is
 * the fast approximation.
 *
 * Run: npx tsx scripts/validateAutopilot.mts
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { MemoryStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import {
  AUTOPILOT_MAX_RSI_FOR_LONG,
  AUTOPILOT_MIN_CONFIDENCE,
  AUTOPILOT_TRAILING,
  PaperAutoPilot,
} from '../src/core/autopilot/paperAutoPilot';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { PositionEngine } from '../src/core/position/positionEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { tradeAnalytics } from '../src/core/position/analytics';
import { drawdownBreached } from '../src/core/risk/drawdownBreaker';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import type { Candle, Timeframe } from '../src/core/types';
import { ok } from '../src/core/types';

/** Mirrors the cloud runner exactly (`server/autopilotRunner.mts`). */
const ENTRY_TF: Timeframe = '1h';
const CONFIRMATION_TF: Timeframe = '4h';
const COST_RATE = 0.003;
const DD_BREAKER_PCT = 8;
const INITIAL_CASH = 10_000;
const CANDLE_LIMIT = 720;
/** Warm-up bars the scanner needs before it can produce a signal. */
const SCAN_WARMUP = 150;

interface Window {
  readonly name: string;
  readonly timestamps: readonly number[];
}

async function main(): Promise<void> {
  const source = new KrakenPublicSource();
  const instruments = await source.getInstruments();
  if (!instruments.ok) {
    console.error(`Could not load instruments: ${instruments.error}`);
    process.exitCode = 1;
    return;
  }
  // The traded universe, exactly as the runner defines it.
  const symbols = instruments.value.slice(0, 10).map((i) => i.symbol);
  console.log(`Fetching real Kraken history for ${symbols.length} traded majors...`);

  const h1 = new Map<string, Candle[]>();
  const h4 = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    const entry = await source.getCandles(symbol, ENTRY_TF, CANDLE_LIMIT);
    const confirm = await source.getCandles(symbol, CONFIRMATION_TF, CANDLE_LIMIT);
    if (entry.ok) h1.set(symbol, entry.value);
    else console.error(`  skipped ${symbol}: ${entry.error}`);
    if (confirm.ok) h4.set(symbol, confirm.value);
  }
  const reference = h1.get(symbols[0]!);
  if (!reference || reference.length <= SCAN_WARMUP) {
    console.error('Not enough history to replay.');
    process.exitCode = 1;
    return;
  }

  const usable = reference.slice(SCAN_WARMUP);
  const mid = Math.floor(usable.length / 2);
  const stamps = usable.map((c) => c.timestamp);
  const windows: Window[] = [
    { name: 'in-sample    ', timestamps: stamps.slice(0, mid) },
    { name: 'out-of-sample', timestamps: stamps.slice(mid) },
    { name: 'full window  ', timestamps: stamps },
  ];

  console.log(`${usable.length} usable bars per symbol (${SCAN_WARMUP} reserved for warm-up).\n`);
  console.log(
    `Config: minConfidence ${AUTOPILOT_MIN_CONFIDENCE}, maxRsiForLong ${AUTOPILOT_MAX_RSI_FOR_LONG}, ` +
      `trailing ${AUTOPILOT_TRAILING.activateR}/${AUTOPILOT_TRAILING.trailR}, cost ${COST_RATE * 100}%/side\n`,
  );

  for (const window of windows) {
    const result = await replay(symbols, h1, h4, window.timestamps);
    console.log(
      `${window.name}: return ${pct(result.returnPct)} | maxDD ${result.maxDrawdownPct.toFixed(2)}% | ` +
        `PF ${result.profitFactor === null ? 'n/a' : result.profitFactor.toFixed(3)} | ` +
        `trades ${result.trades} | win ${result.winRatePct === null ? 'n/a' : `${result.winRatePct.toFixed(1)}%`}`,
    );
  }
}

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`;

interface ReplayResult {
  returnPct: number;
  maxDrawdownPct: number;
  profitFactor: number | null;
  winRatePct: number | null;
  trades: number;
}

async function replay(
  symbols: readonly string[],
  h1: Map<string, Candle[]>,
  h4: Map<string, Candle[]>,
  timestamps: readonly number[],
): Promise<ReplayResult> {
  // Reveals candles only up to a movable clock, so there is no look-ahead.
  let clock = 0;
  const source: MarketDataSource = {
    name: 'historical-replay',
    getInstruments: async () => ok(symbols.map((s) => ({ symbol: s, base: s, quote: 'EUR' }))),
    getCandles: async (symbol, timeframe, limit) => {
      const series = (timeframe === CONFIRMATION_TF ? h4 : h1).get(symbol) ?? [];
      return ok(series.filter((c) => c.timestamp <= clock).slice(-limit));
    },
  };

  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash: INITIAL_CASH,
    baseCurrency: 'EUR',
  });

  let peak = INITIAL_CASH;
  let equity = INITIAL_CASH;

  const pilot = new PaperAutoPilot({
    source,
    symbols,
    timeframe: ENTRY_TF,
    confirmationTimeframe: CONFIRMATION_TF,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0,
    costRate: COST_RATE,
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    trailing: AUTOPILOT_TRAILING,
    riskLimits: DEFAULT_RISK_LIMITS,
    haltNewEntries: () =>
      drawdownBreached({ peakEquity: peak, currentEquity: equity, maxDrawdownPct: DD_BREAKER_PCT }),
  });

  for (const timestamp of timestamps) {
    clock = timestamp;
    await pilot.runCycleOnce(timestamp);
    // Mark to market before reading equity, exactly as the runner does.
    const prices: Record<string, number> = {};
    for (const position of portfolio.openPositions()) {
      const series = h1.get(position.symbol) ?? [];
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i]!.timestamp <= timestamp) {
          prices[position.symbol] = series[i]!.close;
          break;
        }
      }
    }
    equity = portfolio.snapshot(prices, timestamp).equity;
    peak = Math.max(peak, equity);
  }

  const analytics = tradeAnalytics(journal.entries(), { initialCash: INITIAL_CASH });
  return {
    returnPct: ((equity - INITIAL_CASH) / INITIAL_CASH) * 100,
    maxDrawdownPct: analytics.maxDrawdownPct,
    profitFactor: analytics.profitFactor,
    winRatePct: analytics.winRatePct,
    trades: analytics.tradeCount,
  };
}

await main();
