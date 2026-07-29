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
import type { Candle } from '../src/core/types';

const LIMIT = 720;
const FOLDS = 3;
/** Bars the scanner needs before it can emit a decision at all. */
const WARMUP = 150;
const COST = 0.003;

interface Cand {
  readonly name: string;
  readonly minConfidence: number;
  readonly criteria?: { maxRsiForLong?: number; atrTargetMultiple?: number };
  readonly evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  readonly trailing?: { activateR: number; trailR: number };
}

const CANDIDATES: Cand[] = [
  { name: 'PROD (live today)', minConfidence: 20, criteria: { maxRsiForLong: 65 }, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'PROD target 3R', minConfidence: 20, criteria: { maxRsiForLong: 65, atrTargetMultiple: 3 } },
  { name: 'MEAN-REVERSION', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: meanReversionSignal, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'MEAN-REV fixed stop', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: meanReversionSignal },
  { name: 'BREAKOUT', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: breakoutSignal },
];

const source = new KrakenPublicSource();
const inst = await source.getInstruments();
if (!inst.ok) throw new Error('no instruments');
const symbols = inst.value.slice(0, 10).map((i) => i.symbol);

const data: { symbol: string; h1: Candle[]; h4: Candle[] }[] = [];
for (const symbol of symbols) {
  const h1 = await source.getCandles(symbol, '1h', LIMIT);
  const h4 = await source.getCandles(symbol, '4h', LIMIT);
  if (!h1.ok || h1.value.length < WARMUP * 2) {
    console.error(`skip ${symbol}`);
    continue;
  }
  data.push({ symbol, h1: h1.value, h4: h4.ok ? h4.value : [] });
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
      timeframe: '1h',
      costRate: COST,
      minConfidence: cand.minConfidence,
      criteria: cand.criteria,
      higherCandles: d.h4,
      confirmationTimeframe: '4h',
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

console.log(`Fold robustness — ${data.length} symbols, ${LIMIT} 1h bars split into ${FOLDS} folds of ~${foldSize} bars (~${Math.round(foldSize / 24)}d each)`);
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
