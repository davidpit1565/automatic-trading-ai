/**
 * Fold-robustness check for a candidate entry family.
 *
 * A single full-window profit factor is easy to manufacture: one lucky trade in
 * a 30-day window moves it a lot. This splits each symbol's history into
 * consecutive, non-overlapping folds and reports the candidate's pooled profit
 * factor in EACH fold, so a config that only works in one stretch is exposed
 * instead of promoted.
 *
 * Run: npx tsx scripts/foldRobustness.mts
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { runLivePipelineBacktest, type LivePipelineTrade } from '../src/core/backtest/livePipeline';
import { meanReversionSignal, breakoutSignal } from '../src/core/signal/alternativeSignals';
import type { ScanResult } from '../src/core/scan/marketScanner';
import type { SignalDecision } from '../src/core/signal/signalEngine';
import type { Candle, Timeframe } from '../src/core/types';

const LIMIT = 720;
const FOLDS = 3;
/** Bars the scanner needs before it can emit a decision at all. */
const WARMUP = 150;
const COST = Number(process.argv[4] ?? 0.003);

/**
 * Entry timeframe, and the higher timeframe used for confirmation.
 *
 * Worth varying because trading cost is fixed per round trip (~0.6%) while the
 * size of a typical move is not: on 1h bars a move is ~1.7% so cost eats ~35%
 * of the risk unit, on 1d bars a move is several percent and the same cost is a
 * far smaller drag. A longer timeframe also buys a far longer history — 720
 * daily bars is ~2 years across several market regimes, which is what makes a
 * fold test meaningful rather than three views of one month.
 *
 *   npx tsx scripts/foldRobustness.mts          # 1h entry, 4h confirmation
 *   npx tsx scripts/foldRobustness.mts 1d 1w    # 1d entry, 1w confirmation
 *   npx tsx scripts/foldRobustness.mts 1d none  # 1d entry, no confirmation
 *   npx tsx scripts/foldRobustness.mts 1h 4h 0   # frictionless, to separate
 *                                                # "no edge" from "edge eaten
 *                                                # by fees"
 */
const ENTRY_TF = (process.argv[2] ?? '1h') as Timeframe;
const CONFIRM_ARG = process.argv[3] ?? '4h';
const CONFIRM_TF = CONFIRM_ARG === 'none' ? null : (CONFIRM_ARG as Timeframe);

interface Cand {
  readonly name: string;
  readonly minConfidence: number;
  readonly criteria?: { maxRsiForLong?: number; atrTargetMultiple?: number; atrStopMultiple?: number };
  readonly evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  readonly trailing?: { activateR: number; trailR: number };
}

const CANDIDATES: Cand[] = [
  { name: 'PROD (live today)', minConfidence: 20, criteria: { maxRsiForLong: 65 }, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'PROD target 3R', minConfidence: 20, criteria: { maxRsiForLong: 65, atrTargetMultiple: 3 } },
  { name: 'MEAN-REVERSION', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: meanReversionSignal, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'MEAN-REV fixed stop', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: meanReversionSignal },
  { name: 'BREAKOUT', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: breakoutSignal },
  // Trend-following geometry: every trail tested so far armed EARLY (0.4-1.0R)
  // and was whipsawed out. The classic shape is the opposite — ride far, and
  // protect only after the move is already large.
  { name: 'TF far target late trail', minConfidence: 20, criteria: { maxRsiForLong: 65, atrTargetMultiple: 12 }, trailing: { activateR: 2.5, trailR: 2 } },
  { name: 'TF 20R trail 3/2', minConfidence: 20, criteria: { maxRsiForLong: 65, atrTargetMultiple: 20 }, trailing: { activateR: 3, trailR: 2 } },
  { name: 'TF 12R trail 2/1.5', minConfidence: 20, criteria: { maxRsiForLong: 65, atrTargetMultiple: 12 }, trailing: { activateR: 2, trailR: 1.5 } },
  { name: 'MEAN-REV far+late trail', minConfidence: 0, criteria: { maxRsiForLong: 100, atrTargetMultiple: 12 }, evaluate: meanReversionSignal, trailing: { activateR: 2.5, trailR: 2 } },
];

const source = new KrakenPublicSource();
const inst = await source.getInstruments();
if (!inst.ok) throw new Error('no instruments');
// Widened 10→20 (2026-09-04), same reason as sweepAutopilot.mts: match the
// traded universe as of the 2026-09-03 curated-list expansion.
const symbols = inst.value.slice(0, 20).map((i) => i.symbol);

const data: { symbol: string; h1: Candle[]; h4: Candle[] }[] = [];
for (const symbol of symbols) {
  const entry = await source.getCandles(symbol, ENTRY_TF, LIMIT);
  const higher = CONFIRM_TF ? await source.getCandles(symbol, CONFIRM_TF, LIMIT) : null;
  if (!entry.ok || entry.value.length < WARMUP * 2) {
    console.error(`skip ${symbol}: only ${entry.ok ? entry.value.length : 0} ${ENTRY_TF} bars`);
    continue;
  }
  data.push({ symbol, h1: entry.value, h4: higher?.ok ? higher.value : [] });
}
console.error(`loaded ${data.length} symbols\n`);

/**
 * Pooled stats for one candidate over one bar-slice of every symbol. Each fold
 * gets its own WARMUP prefix so the scanner is warm inside the fold rather than
 * borrowing bars the fold is meant to exclude.
 */
function measure(cand: Cand, from: number, to: number): { pf: number; ret: number; trades: number; winPct: number } {
  let gp = 0;
  let gl = 0;
  let trades = 0;
  let wins = 0;
  let retSum = 0;
  for (const d of data) {
    const start = Math.max(0, from - WARMUP);
    const slice = d.h1.slice(start, to);
    if (slice.length < WARMUP + 10) continue;
    const res = runLivePipelineBacktest(slice, {
      symbol: d.symbol,
      timeframe: ENTRY_TF,
      costRate: COST,
      minConfidence: cand.minConfidence,
      criteria: cand.criteria,
      ...(CONFIRM_TF && d.h4.length > 0
        ? { higherCandles: d.h4, confirmationTimeframe: CONFIRM_TF }
        : {}),
      ...(cand.trailing ? { trailing: cand.trailing } : {}),
      ...(cand.evaluate ? { evaluate: cand.evaluate } : {}),
    });
    retSum += res.totalReturnPct;
    for (const t of res.closedTrades as LivePipelineTrade[]) {
      trades++;
      if (t.pnl > 0) {
        wins++;
        gp += t.pnl;
      } else {
        gl += -t.pnl;
      }
    }
  }
  return {
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    ret: retSum / data.length,
    trades,
    winPct: trades > 0 ? (wins / trades) * 100 : 0,
  };
}

const foldSize = Math.floor(LIMIT / FOLDS);
const num = (v: number, n = 2): string => (v === Infinity ? '999' : v.toFixed(n)).padStart(7);

const barsPerDay = ENTRY_TF === '1d' ? 1 : ENTRY_TF === '4h' ? 6 : 24;
console.log(`Fold robustness — ${data.length} symbols, ${LIMIT} ${ENTRY_TF} bars (confirmation: ${CONFIRM_TF ?? 'none'}) split into ${FOLDS} folds of ~${foldSize} bars (~${Math.round(foldSize / barsPerDay)}d each, ${WARMUP} warm-up)`);
console.log(`after fees ${COST * 100}%/side. A candidate that only works in one fold is noise, not an edge.\n`);
console.log('candidate'.padEnd(22) + ['fold1 PF', 'fold2 PF', 'fold3 PF', 'folds>1', 'all PF', 'all ret%', 'trades'].map((h) => h.padStart(9)).join(''));
console.log('-'.repeat(22 + 9 * 7));

for (const cand of CANDIDATES) {
  const folds = Array.from({ length: FOLDS }, (_, f) =>
    measure(cand, f * foldSize, (f + 1) * foldSize),
  );
  const all = measure(cand, 0, LIMIT);
  const good = folds.filter((f) => f.pf > 1).length;
  console.log(
    cand.name.padEnd(22) +
      folds.map((f) => num(f.pf)).join('  ') +
      `${good}/${FOLDS}`.padStart(9) +
      num(all.pf) +
      num(all.ret) +
      String(all.trades).padStart(9),
  );
}
