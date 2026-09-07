/**
 * Prop-firm constraint replay — the one-day, zero-cost measurement tool the
 * audit called for (see the audit doc referenced in the task that produced
 * this script). Does NOT integrate with any prop firm. Replays the EXISTING
 * production strategy (the real `PaperAutoPilot`, faithfully, exactly as
 * `validateAutopilot.mts` replays it) over real Kraken history, and checks
 * whether that replay would have passed or breached two real prop-firm
 * rulesets (Kraken Prop/Breakout, HyroTrader) under a grid of exposure/
 * position-count configs and rolling start dates.
 *
 * Pure backtest/research tooling: no real money, no live-order path.
 *
 * HONEST LIMIT ON HOW MUCH HISTORY IS ACTUALLY AVAILABLE (measured live,
 * 2026-09-07 — see `scripts/lib/fetchExtendedHistory.mts`'s header for the
 * probe): Kraken's public `/OHLC` endpoint always returns its ~721-row cap
 * of the MOST RECENT candles once the requested window exceeds that cap —
 * `since` cannot address an older window past it, for any pair or interval.
 * So 1h history here tops out around ~30 real calendar days per symbol
 * (confirmed identical for a major like XBTEUR and a newer listing like
 * ENAEUR) — NOT the 12-24 months this tool would ideally replay over. The
 * PROP_TARGET_MONTHS knob below is kept as the aspirational target (and
 * would be honoured automatically if Kraken ever served more, or a future
 * `HistoryFetcher` backed a different provider); every run reports the REAL
 * fetched range and bar count per symbol so the reader can judge how much to
 * trust the result, per this tool's own honesty requirement. With ~30 days
 * of usable 1h history, the "weekly-offset rolling starts" the audit asked
 * for necessarily produces a THIN sample (a handful of overlapping windows,
 * not the ~100 a full year would give) — reported as exactly what it is,
 * not padded to look more conclusive than it is.
 *
 * Scope knobs (env vars — defaults are the FULL production-scale scope the
 * audit asked for; override to shrink a run that would otherwise take too
 * long against Kraken's public rate limits):
 *   PROP_SYMBOL_COUNT      how many of CURATED_INSTRUMENTS to use (default: all)
 *   PROP_TARGET_MONTHS     months of 1h history to target per symbol (default: 24)
 *   PROP_ROLL_STEP_DAYS    spacing between rolling start dates (default: 7)
 *   PROP_MAX_RUN_DAYS      cap on a single rolling run's length (default: 60)
 *   PROP_MAX_FETCH_ITERATIONS  pagination iterations per symbol/timeframe (default: 60)
 *
 * Run: npx tsx scripts/propConstraintReplay.mts
 */

import { CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import { DEFAULT_RISK_LIMITS, type RiskLimits } from '../src/core/risk/riskEngine';
import {
  evaluatePropRun,
  feesForBar,
  worstDailyDrawdownPct,
  type PropBar,
  type PropOutcome,
  type PropRulesetConfig,
} from '../src/core/risk/propRiskKernel';
import type { Candle, Timeframe } from '../src/core/types';
import { createHistoryFetcher } from './lib/fetchExtendedHistory.mts';
import { runPropReplay, type PropReplayBar } from './lib/propReplayHarness.mts';

// --- Faithful-replay config (mirrors validateAutopilot.mts / the cloud runner) ---
const ENTRY_TF: Timeframe = '1h';
const CONFIRMATION_TF: Timeframe = '4h';
const COST_RATE = 0.003;
const DD_BREAKER_PCT = 8;
const INITIAL_CASH = 10_000; // EUR — this system is EUR-only; a prop account's own currency
// may differ, but the RATIOS (%) evaluatePropRun works in are currency-agnostic.
const SCAN_WARMUP = 150;
const BAR_HOURS = 1;

// --- Scope knobs ---
const SYMBOL_COUNT = envInt('PROP_SYMBOL_COUNT', CURATED_INSTRUMENTS.length);
const TARGET_MONTHS = envInt('PROP_TARGET_MONTHS', 24);
const ROLL_STEP_DAYS = envInt('PROP_ROLL_STEP_DAYS', 7);
const MAX_RUN_DAYS = envInt('PROP_MAX_RUN_DAYS', 60);
const MAX_FETCH_ITERATIONS = envInt('PROP_MAX_FETCH_ITERATIONS', 60);

const TARGET_BARS_1H = Math.round(TARGET_MONTHS * 30 * 24);
const TARGET_BARS_4H = Math.round(TARGET_BARS_1H / 4);
const ROLL_STEP_BARS = ROLL_STEP_DAYS * 24;
const MAX_RUN_BARS = MAX_RUN_DAYS * 24;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// --- The exposure/position-count grid the audit called for (9 combinations) ---
const EXPOSURE_GRID = [60, 40, 20];
const POSITION_GRID = [5, 3, 2];
interface ReplayConfig {
  readonly label: string;
  readonly riskLimits: RiskLimits;
}
const REPLAY_CONFIGS: ReplayConfig[] = EXPOSURE_GRID.flatMap((maxTotalExposurePct) =>
  POSITION_GRID.map((maxOpenPositions) => ({
    label: `exposure ${maxTotalExposurePct}% / positions ${maxOpenPositions}`,
    riskLimits: { ...DEFAULT_RISK_LIMITS, maxTotalExposurePct, maxOpenPositions },
  })),
);

// --- The two rulesets ---
const BREAKOUT: PropRulesetConfig = {
  name: 'Kraken Prop / Breakout 1-Step Classic',
  profitTargetPct: 10,
  maxDailyLossPct: 3,
  maxDrawdownPct: 6,
  dailyResetHourUtc: 0.5, // 00:30 UTC, per the audit's sourcing
  feePctPerSide: 0.04,
  swapPctPerDayPerPosition: 0.033,
};
const HYROTRADER: PropRulesetConfig = {
  name: 'HyroTrader 1-Step',
  profitTargetPct: 10,
  maxDailyLossPct: 4,
  maxDrawdownPct: 6,
  // ASSUMPTION: no stated daily-reset time found for HyroTrader — modeled as
  // midnight UTC, the common default among prop-CFD platforms.
  dailyResetHourUtc: 0,
  // ASSUMPTION: no stated fee/swap drag figure found for HyroTrader — modeled
  // as 0 rather than padded from Breakout's figure. This likely UNDERSTATES
  // HyroTrader's real fee drag; treat its P(pass) as an upper bound.
};
const RULESETS: PropRulesetConfig[] = [BREAKOUT, HYROTRADER];

interface RunDiagnostics {
  readonly outcome: PropOutcome;
  readonly worstDailyDrawdownPct: number;
  readonly totalFees: number;
}

function evaluate(bars: readonly PropReplayBar[], ruleset: PropRulesetConfig): RunDiagnostics {
  const propBars: PropBar[] = bars.map((b) => ({
    timestamp: b.timestamp,
    equityLow: b.equityLow,
    equityHigh: b.equityHigh,
    equityClose: b.equityClose,
    feesThisBar: feesForBar(b, ruleset),
  }));
  const outcome = evaluatePropRun(propBars, INITIAL_CASH, ruleset);
  const totalFees = propBars.reduce((sum, b) => sum + b.feesThisBar, 0);
  return { outcome, worstDailyDrawdownPct: worstDailyDrawdownPct(propBars, INITIAL_CASH, ruleset), totalFees };
}

interface Aggregate {
  total: number;
  pass: number;
  breach: number;
  breachDaily: number;
  breachTotal: number;
  ongoing: number;
  barsElapsed: number[];
  worstDailyDdMax: number;
  feesPctOfBudgetSum: number;
}
function newAggregate(): Aggregate {
  return {
    total: 0,
    pass: 0,
    breach: 0,
    breachDaily: 0,
    breachTotal: 0,
    ongoing: 0,
    barsElapsed: [],
    worstDailyDdMax: 0,
    feesPctOfBudgetSum: 0,
  };
}
function record(agg: Aggregate, diag: RunDiagnostics, ruleset: PropRulesetConfig): void {
  agg.total++;
  if (diag.outcome.kind === 'pass') {
    agg.pass++;
    agg.barsElapsed.push(diag.outcome.barsElapsed);
  } else if (diag.outcome.kind === 'breach') {
    agg.breach++;
    if (diag.outcome.cause === 'daily') agg.breachDaily++;
    else agg.breachTotal++;
    agg.barsElapsed.push(diag.outcome.barsElapsed);
  } else {
    agg.ongoing++;
  }
  agg.worstDailyDdMax = Math.max(agg.worstDailyDdMax, diag.worstDailyDrawdownPct);
  const ddBudget = INITIAL_CASH * (ruleset.maxDrawdownPct / 100);
  agg.feesPctOfBudgetSum += ddBudget > 0 ? (diag.totalFees / ddBudget) * 100 : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const pct = (v: number, digits = 1): string => `${v.toFixed(digits)}%`;
const isoOf = (ms: number): string => new Date(ms).toISOString();

async function main(): Promise<void> {
  const symbols = CURATED_INSTRUMENTS.slice(0, SYMBOL_COUNT).map((i) => i.symbol);
  console.log('='.repeat(78));
  console.log('PROP-FIRM CONSTRAINT REPLAY — measurement only, no live-order path');
  console.log('='.repeat(78));
  console.log(
    `Scope: ${symbols.length} symbols | target ${TARGET_MONTHS}mo of 1h history | ` +
      `roll step ${ROLL_STEP_DAYS}d | max run length ${MAX_RUN_DAYS}d | ${REPLAY_CONFIGS.length} configs × ${RULESETS.length} rulesets\n`,
  );

  const fetcher = createHistoryFetcher();
  const h1 = new Map<string, Candle[]>();
  const h4 = new Map<string, Candle[]>();
  const usableSymbols: string[] = [];

  console.log('Fetching real Kraken history (paginated backward, cached under .cache/prop-replay/):');
  for (const symbol of symbols) {
    const entry = await fetcher.fetchSymbolHistory(symbol, ENTRY_TF, TARGET_BARS_1H, {
      maxIterations: MAX_FETCH_ITERATIONS,
    });
    const confirm = await fetcher.fetchSymbolHistory(symbol, CONFIRMATION_TF, TARGET_BARS_4H, {
      maxIterations: MAX_FETCH_ITERATIONS,
    });
    if (entry.error || entry.candles.length === 0) {
      console.log(`  ${symbol}: SKIPPED (1h fetch failed: ${entry.error ?? 'no candles returned'})`);
      continue;
    }
    const first = entry.candles[0]!;
    const last = entry.candles[entry.candles.length - 1]!;
    console.log(
      `  ${symbol}: ${entry.candles.length} × 1h bars, ${isoOf(first.timestamp)} -> ${isoOf(last.timestamp)}` +
        `${entry.exhausted ? ' (Kraken history exhausted — this is ALL that pair has)' : ''}` +
        ` | 4h: ${confirm.candles.length} bars${confirm.error ? ` (confirm fetch failed: ${confirm.error})` : ''}`,
    );
    h1.set(symbol, entry.candles as Candle[]);
    h4.set(symbol, confirm.candles as Candle[]);
    usableSymbols.push(symbol);
  }

  if (usableSymbols.length === 0) {
    console.error('\nNo symbols had usable history — aborting.');
    process.exitCode = 1;
    return;
  }
  const actualBars1h = h1.get(usableSymbols[0]!)!.length;
  if (actualBars1h < TARGET_BARS_1H) {
    console.log(
      `\nNOTE: targeted ${TARGET_BARS_1H} 1h bars (${TARGET_MONTHS}mo) but Kraken's public OHLC only ever ` +
        `serves ~721 of the most recent candles regardless of pagination (measured live — see ` +
        `fetchExtendedHistory.mts's header) — got ${actualBars1h} real bars per symbol (~${(actualBars1h / 24).toFixed(0)} days). ` +
        `This is the real, honest ceiling, not a fetch failure.`,
    );
  }

  const reference = h1.get(usableSymbols[0]!)!;
  if (reference.length <= SCAN_WARMUP + 24) {
    console.error(
      `\nNot enough history on the reference symbol (${usableSymbols[0]}) to run even one rolling window ` +
        `(${reference.length} bars, need > ${SCAN_WARMUP + 24}).`,
    );
    process.exitCode = 1;
    return;
  }

  const usableTimestamps = reference.slice(SCAN_WARMUP).map((c) => c.timestamp);
  const starts: number[] = [];
  for (let idx = 0; idx < usableTimestamps.length; idx += ROLL_STEP_BARS) {
    if (usableTimestamps.length - idx < 24) break; // need at least a day left to be worth running
    starts.push(idx);
  }
  console.log(
    `\n${usableTimestamps.length} usable bars on ${usableSymbols[0]} after ${SCAN_WARMUP}-bar warm-up -> ` +
      `${starts.length} rolling start dates (weekly-offset, ${ROLL_STEP_DAYS}d step).\n`,
  );

  // ruleset name -> config label -> Aggregate
  const aggregates = new Map<string, Map<string, Aggregate>>();
  for (const ruleset of RULESETS) {
    aggregates.set(ruleset.name, new Map(REPLAY_CONFIGS.map((c) => [c.label, newAggregate()])));
  }

  let runsDone = 0;
  const totalRuns = REPLAY_CONFIGS.length * starts.length;
  for (const config of REPLAY_CONFIGS) {
    for (const startIdx of starts) {
      const timestamps = usableTimestamps.slice(startIdx, startIdx + MAX_RUN_BARS);
      const result = await runPropReplay({
        symbols: usableSymbols,
        h1,
        h4,
        timestamps,
        initialCash: INITIAL_CASH,
        riskLimits: config.riskLimits,
        entryTf: ENTRY_TF,
        confirmationTf: CONFIRMATION_TF,
        costRate: COST_RATE,
        ddBreakerPct: DD_BREAKER_PCT,
        barHours: BAR_HOURS,
      });
      for (const ruleset of RULESETS) {
        const diag = evaluate(result.bars, ruleset);
        record(aggregates.get(ruleset.name)!.get(config.label)!, diag, ruleset);
      }
      runsDone++;
      if (runsDone % 10 === 0 || runsDone === totalRuns) {
        console.log(`  ... ${runsDone}/${totalRuns} replay runs done`);
      }
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('RESULTS');
  console.log('='.repeat(78));

  for (const ruleset of RULESETS) {
    console.log(`\n--- ${ruleset.name} ---`);
    console.log(
      `(target ${ruleset.profitTargetPct}% / daily ${ruleset.maxDailyLossPct}% / static DD ${ruleset.maxDrawdownPct}% / ` +
        `fee ${ruleset.feePctPerSide ?? 0}%/side / swap ${ruleset.swapPctPerDayPerPosition ?? 0}%/day / ` +
        `reset ${ruleset.dailyResetHourUtc}h UTC)`,
    );
    let bestPassRate = -1;
    let bestLabel = '';
    for (const config of REPLAY_CONFIGS) {
      const agg = aggregates.get(ruleset.name)!.get(config.label)!;
      const passRate = agg.total > 0 ? (agg.pass / agg.total) * 100 : 0;
      const breachRate = agg.total > 0 ? (agg.breach / agg.total) * 100 : 0;
      const ongoingRate = agg.total > 0 ? (agg.ongoing / agg.total) * 100 : 0;
      const dailyShare = agg.breach > 0 ? (agg.breachDaily / agg.breach) * 100 : 0;
      const totalShare = agg.breach > 0 ? (agg.breachTotal / agg.breach) * 100 : 0;
      const med = median(agg.barsElapsed);
      const avgFeesPctOfBudget = agg.total > 0 ? agg.feesPctOfBudgetSum / agg.total : 0;
      console.log(
        `  ${config.label.padEnd(28)} n=${agg.total} | P(pass) ${pct(passRate)} | ` +
          `P(breach) ${pct(breachRate)} (daily ${pct(dailyShare)}, total ${pct(totalShare)}) | ` +
          `ongoing ${pct(ongoingRate)} | median bars ${med === null ? 'n/a' : med.toFixed(0)} | ` +
          `worst daily DD ${pct(agg.worstDailyDdMax)} | fees ${pct(avgFeesPctOfBudget)} of DD budget`,
      );
      if (passRate > bestPassRate) {
        bestPassRate = passRate;
        bestLabel = config.label;
      }
    }
    console.log(`  Best config: ${bestLabel} — P(pass) ${pct(bestPassRate)}`);
    if (bestPassRate < 30) {
      console.log(`  VERDICT: P(pass) < 30% — prop is DEAD for ${ruleset.name}. Do not build the integration.`);
    } else if (bestPassRate <= 50) {
      console.log(`  VERDICT: P(pass) 30-50% — viable only de-risked for ${ruleset.name}.`);
    } else {
      console.log(`  VERDICT: P(pass) > 50% — proceed to Phase 1 for ${ruleset.name}.`);
    }
  }

  console.log('\n' + '='.repeat(78));
}

await main();
