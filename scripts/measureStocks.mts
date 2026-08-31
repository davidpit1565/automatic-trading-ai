/**
 * Measure the US-stocks arm on REAL Alpaca history.
 *
 * The stocks arm shipped with strategy constants that are ENGINE DEFAULTS, not
 * measured values — there was no Alpaca history to measure against until the
 * credentials went live. This closes that gap, and it applies exactly the bar
 * the crypto arm was held to: a per-fold stability gate, plus a buy-and-hold
 * benchmark, plus cost sensitivity. A config that only wins in one stretch is
 * reported as failing.
 *
 * Two reasons this measurement can say more than the crypto one:
 *   - Alpaca serves ~5 YEARS of daily bars (Kraken caps at 720), so folds cover
 *     genuinely different market regimes rather than three views of one month.
 *   - Alpaca is commission-free, so the arm's cost is ~0.1%/side of slippage
 *     rather than crypto's ~0.3% of fee-plus-slippage. Cost was never the cause
 *     of the crypto result, but it did size the loss, so a third of the drag is
 *     a materially different starting point.
 *
 * Needs ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY, so it runs in GitHub Actions
 * (.github/workflows/measure-stocks.yml) where the secrets live.
 *
 *   npx tsx scripts/measureStocks.mts                # 1d bars (5y), the 10 traded majors
 *   npx tsx scripts/measureStocks.mts 1h             # 1h bars (180d), the 10 traded majors
 *   npx tsx scripts/measureStocks.mts 1d candidates  # the 40 browsable-only symbols —
 *                                                     # is there a real edge to promote any
 *                                                     # of them to the TRADED list?
 */

import {
  AlpacaStockSource,
  CURATED_STOCK_INSTRUMENTS,
  BROWSABLE_STOCK_INSTRUMENTS,
} from '../src/core/data/alpacaStocks';
import { runLivePipelineBacktest, type LivePipelineTrade } from '../src/core/backtest/livePipeline';
import { meanReversionSignal, breakoutSignal } from '../src/core/signal/alternativeSignals';
import type { ScanResult } from '../src/core/scan/marketScanner';
import type { SignalDecision } from '../src/core/signal/signalEngine';
import type { Candle, Timeframe } from '../src/core/types';

const TF = (process.argv[2] ?? '1d') as Timeframe;
const MODE = process.argv[3] === 'candidates' ? 'candidates' : 'traded';
/** The 40 browsable-only symbols (BROWSABLE minus the 10 already traded) —
 * candidates for promotion to CURATED_STOCK_INSTRUMENTS, not yet traded by
 * anything. Measuring them is what decides whether any of them should be. */
const TRADED_SYMBOLS = new Set(CURATED_STOCK_INSTRUMENTS.map((i) => i.symbol));
const INSTRUMENTS =
  MODE === 'candidates'
    ? BROWSABLE_STOCK_INSTRUMENTS.filter((i) => !TRADED_SYMBOLS.has(i.symbol))
    : CURATED_STOCK_INSTRUMENTS;
const LIMIT = TF === '1d' ? 1260 : 1000; // ~5y of trading days, or ~180d of hours
const FOLDS = 3;
const WARMUP = 150;
/** The arm's live cost: Alpaca charges no commission, so this is slippage only. */
const LIVE_COST = 0.001;
const COSTS = [LIVE_COST, 0.0005, 0];

const keyId = process.env['ALPACA_API_KEY_ID'] ?? '';
const secret = process.env['ALPACA_API_SECRET_KEY'] ?? '';
if (!keyId || !secret) {
  console.error('ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are required.');
  process.exit(1);
}
const source = new AlpacaStockSource({ apiKeyId: keyId, apiSecretKey: secret });

interface Cand {
  readonly name: string;
  readonly minConfidence: number;
  readonly criteria?: { maxRsiForLong?: number; atrTargetMultiple?: number; atrStopMultiple?: number };
  readonly evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  readonly trailing?: { activateR: number; trailR: number };
  readonly trendExit?: { emaPeriod: number };
}

/**
 * The live stocks config first (engine defaults — what is actually trading), then
 * the same families and geometries the crypto arm was measured on, so the two
 * arms are comparable rather than each judged on its own private grid.
 */
const CANDIDATES: Cand[] = [
  { name: 'LIVE stocks (defaults)', minConfidence: 20 },
  { name: 'live + trail 1.5/1.5', minConfidence: 20, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'target 3R', minConfidence: 20, criteria: { atrTargetMultiple: 3 } },
  { name: 'target 6R', minConfidence: 20, criteria: { atrTargetMultiple: 6 } },
  { name: 'rsi ceiling 65', minConfidence: 20, criteria: { maxRsiForLong: 65 } },
  { name: 'conf 40', minConfidence: 40 },
  { name: 'MEAN-REVERSION', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: meanReversionSignal },
  { name: 'BREAKOUT', minConfidence: 0, criteria: { maxRsiForLong: 100 }, evaluate: breakoutSignal },
  // Hold-through-trend: the live config's ~200 trades and 3.9% drawdown against
  // a basket that tripled says it sits out or caps winners through most of a
  // large uptrend (see PROJECT_STATE). These replace the fixed take-profit with
  // a trend-following exit -- close below a trailing EMA -- same entries, same
  // protective stop, only the "when do we take profit" question changes.
  { name: 'trend-exit EMA10', minConfidence: 20, trendExit: { emaPeriod: 10 } },
  { name: 'trend-exit EMA20', minConfidence: 20, trendExit: { emaPeriod: 20 } },
  { name: 'trend-exit EMA50', minConfidence: 20, trendExit: { emaPeriod: 50 } },
  { name: 'trend-exit EMA20 rsi65', minConfidence: 20, criteria: { maxRsiForLong: 65 }, trendExit: { emaPeriod: 20 } },
  { name: 'trend-exit EMA20 conf40', minConfidence: 40, trendExit: { emaPeriod: 20 } },
];

const data: { symbol: string; bars: Candle[] }[] = [];
for (const inst of INSTRUMENTS) {
  const res = await source.getCandles(inst.symbol, TF, LIMIT);
  if (!res.ok) {
    console.error(`skip ${inst.symbol}: ${res.error}`);
    continue;
  }
  if (res.value.length < WARMUP * 2) {
    console.error(`skip ${inst.symbol}: only ${res.value.length} ${TF} bars`);
    continue;
  }
  data.push({ symbol: inst.symbol, bars: res.value });
  console.error(`fetched ${inst.symbol}: ${res.value.length} ${TF} bars`);
}
if (data.length === 0) {
  console.error('no data — cannot measure');
  process.exit(1);
}
const N = Math.min(...data.map((d) => d.bars.length));
console.error(`\n[${MODE}] ${data.length} symbols, min ${N} ${TF} bars each\n`);

/** Equal-weight buy & hold of the basket over a bar range — the honest benchmark. */
function basket(from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (const d of data) {
    const b = d.bars;
    if (to > b.length || from >= to) continue;
    sum += (b[to - 1]!.close - b[from]!.close) / b[from]!.close;
    n++;
  }
  return n > 0 ? (sum / n) * 100 : 0;
}

/**
 * Pooled stats for one candidate over one bar-slice of every symbol. Each fold
 * gets its own WARMUP prefix so the scanner is warm inside the fold rather than
 * borrowing bars the fold is meant to exclude.
 */
function measure(c: Cand, from: number, to: number, cost: number): { pf: number; ret: number; trades: number; winPct: number; dd: number } {
  let gp = 0;
  let gl = 0;
  let trades = 0;
  let wins = 0;
  let retSum = 0;
  let ddSum = 0;
  let n = 0;
  for (const d of data) {
    const slice = d.bars.slice(Math.max(0, from - WARMUP), to);
    if (slice.length < WARMUP + 10) continue;
    const res = runLivePipelineBacktest(slice, {
      symbol: d.symbol,
      timeframe: TF,
      costRate: cost,
      minConfidence: c.minConfidence,
      criteria: c.criteria,
      ...(c.trailing ? { trailing: c.trailing } : {}),
      ...(c.evaluate ? { evaluate: c.evaluate } : {}),
      ...(c.trendExit ? { trendExit: c.trendExit } : {}),
    });
    retSum += res.totalReturnPct;
    ddSum += res.maxDrawdownPct;
    n++;
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
    ret: n > 0 ? retSum / n : 0,
    dd: n > 0 ? ddSum / n : 0,
    trades,
    winPct: trades > 0 ? (wins / trades) * 100 : 0,
  };
}

const foldSize = Math.floor(N / FOLDS);
const num = (v: number, w = 8): string => (v === Infinity ? '999' : v.toFixed(2)).padStart(w);

for (const cost of COSTS) {
  const label = cost === LIVE_COST ? ' (LIVE)' : cost === 0 ? ' (frictionless)' : '';
  console.log(
    `\n${'='.repeat(94)}\nUS stocks [${MODE}] — ${data.length} symbols, ${N} ${TF} bars, ${FOLDS} folds of ~${foldSize}, cost ${(cost * 100).toFixed(2)}%/side${label}`,
  );
  console.log(`Bar to clear: PF > 1.2 in EVERY fold AND beat the basket. ${'='.repeat(20)}`);
  console.log(
    'candidate'.padEnd(24) +
      ['f1 PF', 'f2 PF', 'f3 PF', 'folds', 'all PF', 'ret%', 'basket', 'win%', 'maxDD', 'trades']
        .map((h) => h.padStart(8))
        .join(''),
  );
  console.log('-'.repeat(24 + 8 * 10));

  const allBasket = basket(0, N);
  for (const c of CANDIDATES) {
    const folds = Array.from({ length: FOLDS }, (_, f) => measure(c, f * foldSize, (f + 1) * foldSize, cost));
    const all = measure(c, 0, N, cost);
    const good = folds.filter((f) => f.pf > 1.2).length;
    console.log(
      c.name.padEnd(24) +
        folds.map((f) => num(f.pf)).join('') +
        `${good}/${FOLDS}`.padStart(8) +
        num(all.pf) +
        num(all.ret) +
        num(allBasket) +
        num(all.winPct) +
        num(all.dd) +
        String(all.trades).padStart(8),
    );
  }
  console.log('-'.repeat(24 + 8 * 10));
  console.log(
    `basket per fold: ${Array.from({ length: FOLDS }, (_, f) => basket(f * foldSize, (f + 1) * foldSize).toFixed(2)).join('%, ')}%  ·  overall ${allBasket.toFixed(2)}%`,
  );
}

/**
 * The tables above are POOLED across every symbol — they answer "does this
 * STRATEGY variant work across the whole candidate basket", not "is THIS
 * ONE symbol individually worth trading". Candidates mode's own stated job
 * is the latter ("is there a real edge to promote any of the 40 browsable-
 * only symbols"), so it needs a per-symbol breakdown too — using just the
 * LIVE default config, at the live cost rate, full window (no folds: a
 * single symbol's own history is already the smallest unit being judged).
 */
if (MODE === 'candidates') {
  console.log(`\n${'='.repeat(94)}\nPer-symbol breakdown — LIVE stocks (defaults), cost ${(LIVE_COST * 100).toFixed(2)}%/side`);
  console.log(
    'symbol'.padEnd(10) +
      ['ret%', 'PF', 'win%', 'trades', 'buy&hold%'].map((h) => h.padStart(12)).join(''),
  );
  console.log('-'.repeat(10 + 12 * 5));
  const perSymbol = data
    .map((d) => {
      const res = runLivePipelineBacktest(d.bars, {
        symbol: d.symbol,
        timeframe: TF,
        costRate: LIVE_COST,
        minConfidence: CANDIDATES[0]!.minConfidence,
        ...(CANDIDATES[0]!.criteria ? { criteria: CANDIDATES[0]!.criteria } : {}),
      });
      const trades = res.closedTrades as LivePipelineTrade[];
      const wins = trades.filter((t) => t.pnl > 0);
      const gp = wins.reduce((s, t) => s + t.pnl, 0);
      const gl = trades.filter((t) => t.pnl <= 0).reduce((s, t) => s - t.pnl, 0);
      const bh = ((d.bars[d.bars.length - 1]!.close - d.bars[0]!.close) / d.bars[0]!.close) * 100;
      return {
        symbol: d.symbol,
        ret: res.totalReturnPct,
        pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
        winPct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        trades: trades.length,
        bh,
      };
    })
    .sort((a, b) => b.ret - a.ret);
  for (const s of perSymbol) {
    console.log(
      s.symbol.padEnd(10) +
        [s.ret.toFixed(2), s.pf === Infinity ? '999' : s.pf.toFixed(2), s.winPct.toFixed(1), String(s.trades), s.bh.toFixed(2)]
          .map((v) => v.padStart(12))
          .join(''),
    );
  }
  console.log('-'.repeat(10 + 12 * 5));
}
