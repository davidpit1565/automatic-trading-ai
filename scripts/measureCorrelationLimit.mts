/**
 * Measures whether the optional correlated-cluster exposure cap
 * (riskEngine.ts's `correlationThreshold`/`maxCorrelatedExposurePct`, wired
 * through `PaperAutoPilot.correlationBetween`) actually helps — before
 * shipping it, per house rules (measure, don't guess).
 *
 * Replays the REAL production autopilot (PaperAutoPilot, same pure engines,
 * same defaults: AUTOPILOT_MIN_CONFIDENCE, AUTOPILOT_MAX_RSI_FOR_LONG,
 * AUTOPILOT_TRAILING, the 4h confirmation gate, the drawdown breaker) over
 * REAL Kraken history for the 10 curated majors, once WITHOUT the
 * correlation cap (baseline) and once WITH it (treatment), split into an
 * in-sample and an out-of-sample half. Reports return, max drawdown, profit
 * factor, and — the metric tied directly to the incident that motivated
 * this — how many cycles closed 2+ positions via stop-loss at once
 * ("clustered stop-outs").
 *
 * Run: npx tsx scripts/measureCorrelationLimit.mts
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
import { buildCorrelationMatrix } from '../src/core/risk/correlation';
import { drawdownBreached } from '../src/core/risk/drawdownBreaker';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import type { Candle, Timeframe } from '../src/core/types';
import { ok } from '../src/core/types';

const SYMBOLS = [
  'XBTEUR', 'ETHEUR', 'SOLEUR', 'XRPEUR', 'ADAEUR',
  'DOGEEUR', 'LTCEUR', 'DOTEUR', 'LINKEUR', 'AVAXEUR',
];
const CONFIRMATION_TF: Timeframe = '4h';
const ENTRY_TF: Timeframe = '1h';
const COST_RATE = 0.003;
const DD_BREAKER_PCT = 8;
// Coarse, reasoned defaults — NOT fit to what most improves this test's
// outcome (that would be curve-fitting the parameter to the data).
const CORRELATION_THRESHOLD = 0.6;
const MAX_CORRELATED_EXPOSURE_PCT = 30;

async function fetchAll(
  source: KrakenPublicSource,
  timeframe: Timeframe,
  limit: number,
): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  for (const symbol of SYMBOLS) {
    const result = await source.getCandles(symbol, timeframe, limit);
    if (result.ok) out.set(symbol, result.value);
    else console.error(`fetch failed for ${symbol} ${timeframe}: ${result.error}`);
  }
  return out;
}

/** In-memory MarketDataSource that only ever reveals candles up to a movable clock — no look-ahead. */
function historicalSource(
  h1: Map<string, Candle[]>,
  h4: Map<string, Candle[]>,
): { source: MarketDataSource; setClock: (t: number) => void } {
  let clock = 0;
  const source: MarketDataSource = {
    name: 'historical-replay',
    getInstruments: async () => ok(SYMBOLS.map((s) => ({ symbol: s, base: s, quote: 'EUR' }))),
    getCandles: async (symbol, timeframe, limit) => {
      const series = (timeframe === CONFIRMATION_TF ? h4 : h1).get(symbol) ?? [];
      const upTo = series.filter((c) => c.timestamp <= clock);
      return ok(upTo.slice(-limit));
    },
  };
  return { source, setClock: (t) => { clock = t; } };
}

interface RunResult {
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winRatePct: number | null;
  profitFactor: number | null;
  clusteredStopCycles: number;
  correlationRejections: number;
}

async function runReplay(
  h1: Map<string, Candle[]>,
  h4: Map<string, Candle[]>,
  testTimestamps: readonly number[],
  correlationCap: boolean,
): Promise<RunResult> {
  const { source, setClock } = historicalSource(h1, h4);
  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'EUR' });
  const audit = new PersistedAuditLog(store);
  const correlationBetween = buildCorrelationMatrix(h1);

  let peak = 10_000;
  let latestEquity = 10_000;

  const pilot = new PaperAutoPilot({
    source,
    symbols: SYMBOLS,
    timeframe: ENTRY_TF,
    confirmationTimeframe: CONFIRMATION_TF,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit,
    getDailyLoss: () => 0, // mirrors production reality (see PROJECT_STATE: DailyLossTracker.record() is never called)
    costRate: COST_RATE,
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    trailing: AUTOPILOT_TRAILING,
    riskLimits: correlationCap
      ? { ...DEFAULT_RISK_LIMITS, correlationThreshold: CORRELATION_THRESHOLD, maxCorrelatedExposurePct: MAX_CORRELATED_EXPOSURE_PCT }
      : DEFAULT_RISK_LIMITS,
    correlationBetween: correlationCap ? correlationBetween : undefined,
    haltNewEntries: () => drawdownBreached({ peakEquity: peak, currentEquity: latestEquity, maxDrawdownPct: DD_BREAKER_PCT }),
  });

  let clusteredStopCycles = 0;
  for (const t of testTimestamps) {
    setClock(t);
    const cycle = await pilot.runCycleOnce(t);
    const stopExits = cycle.closed.filter((c) => c.reason === 'stop-loss').length;
    if (stopExits >= 2) clusteredStopCycles++;
    latestEquity = portfolio.snapshot({}, t).equity;
    peak = Math.max(peak, latestEquity);
  }

  const correlationRejections = audit
    .entries()
    .filter((e) => e.event === 'rejected' && e.detail.includes('correlated-cluster')).length;

  const analytics = tradeAnalytics(journal.entries(), { initialCash: 10_000 });
  return {
    finalEquity: latestEquity,
    totalReturnPct: ((latestEquity - 10_000) / 10_000) * 100,
    maxDrawdownPct: analytics.maxDrawdownPct,
    tradeCount: analytics.tradeCount,
    winRatePct: analytics.winRatePct,
    profitFactor: analytics.profitFactor,
    clusteredStopCycles,
    correlationRejections,
  };
}

function report(label: string, r: RunResult): void {
  console.log(
    `${label}: return ${r.totalReturnPct.toFixed(2)}% | maxDD ${r.maxDrawdownPct.toFixed(2)}% | ` +
      `trades ${r.tradeCount} | win% ${r.winRatePct?.toFixed(1) ?? 'n/a'} | PF ${r.profitFactor?.toFixed(2) ?? 'n/a'} | ` +
      `clustered stop-out cycles ${r.clusteredStopCycles} | correlation-cap rejections ${r.correlationRejections}`,
  );
}

async function main(): Promise<void> {
  const source = new KrakenPublicSource();
  console.log('Fetching real Kraken history for the 10 curated majors...');
  const [h1, h4] = await Promise.all([
    fetchAll(source, ENTRY_TF, 720), // ~30 days, Kraken's 1h cap
    fetchAll(source, CONFIRMATION_TF, 400), // ~66 days, covers the 1h window plus warmup
  ]);

  const anySeries = h1.get(SYMBOLS[0]!)!;
  const scanWindow = 150; // mirrors SCAN_CANDLES in paperAutoPilot.ts
  const usable = anySeries.slice(scanWindow); // first `scanWindow` bars are warmup-only, not test bars
  const mid = Math.floor(usable.length / 2);
  const inSample = usable.slice(0, mid).map((c) => c.timestamp);
  const outOfSample = usable.slice(mid).map((c) => c.timestamp);
  console.log(`Total usable bars: ${usable.length} (in-sample ${inSample.length}, out-of-sample ${outOfSample.length})`);

  console.log('\n--- IN-SAMPLE ---');
  report('baseline (no correlation cap)', await runReplay(h1, h4, inSample, false));
  report('treatment (correlation cap)  ', await runReplay(h1, h4, inSample, true));

  console.log('\n--- OUT-OF-SAMPLE ---');
  report('baseline (no correlation cap)', await runReplay(h1, h4, outOfSample, false));
  report('treatment (correlation cap)  ', await runReplay(h1, h4, outOfSample, true));
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
