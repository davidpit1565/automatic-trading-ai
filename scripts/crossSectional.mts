/**
 * Cross-sectional relative strength — a portfolio-level signal.
 *
 * Every signal measured so far is ABSOLUTE and per-symbol: it asks "is BTC
 * strong?" and answers from BTC's own bars. On ten highly-correlated majors that
 * fires on all of them at once whenever the whole market moves, which is not
 * selection — it is leverage on beta. It is also exactly how ADA, LINK and LTC
 * came to be stopped out together on 2026-07-20.
 *
 * A cross-sectional signal asks a different question: "is BTC strong RELATIVE to
 * the other nine?" It ranks the basket at each rebalance and holds the top K,
 * so it is beta-neutral by construction — in a broad selloff it holds whatever
 * fell least, and the return comes from dispersion rather than direction. This
 * is a different KIND of input, not another threshold on the same one, which is
 * why it is worth measuring after absolute signals were exhausted.
 *
 * The benchmark is deliberately NOT profit factor. PF suits discrete-trade
 * strategies; this holds continuously. Since equal-weight buy & hold beat every
 * strategy measured this session, the honest bar is: **beat the equal-weight
 * basket, in every fold.** A variant that wins overall on one lucky stretch is
 * reported as failing, the same standard `foldRobustness.mts` applies.
 *
 *   npx tsx scripts/crossSectional.mts           # 1h bars
 *   npx tsx scripts/crossSectional.mts 1d        # 1d bars (~2 years)
 *   npx tsx scripts/crossSectional.mts 1h 0      # frictionless
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import type { Candle, Timeframe } from '../src/core/types';

const LIMIT = 720;
const FOLDS = 3;
const INITIAL = 10_000;
const TF = (process.argv[2] ?? '1h') as Timeframe;
/** Per-side cost as a fraction of the notional traded (fee + slippage). */
const COST = Number(process.argv[3] ?? 0.003);

interface Variant {
  readonly name: string;
  /** Bars of return used to rank. */
  readonly lookback: number;
  /**
   * Bars to skip between the end of the ranking window and the entry. Classic
   * momentum work skips the most recent period because short-horizon returns
   * mean-revert and contaminate the ranking.
   */
  readonly skip: number;
  /** How many of the ranked symbols to hold, equal-weight. */
  readonly top: number;
  /** Bars between rebalances. */
  readonly rebalance: number;
  /** Hold the WEAKEST instead — cross-sectional mean reversion. */
  readonly invert?: boolean;
}

const VARIANTS: Variant[] = [
  // Reversion lookback plateau test: a real effect degrades smoothly around its
  // best setting, an overfit one is a spike with dead neighbours.
  { name: 'REV lb36/top2', lookback: 36, skip: 0, top: 2, rebalance: 24, invert: true },
  { name: 'REV lb48/top2', lookback: 48, skip: 0, top: 2, rebalance: 24, invert: true },
  { name: 'REV lb60/top2', lookback: 60, skip: 0, top: 2, rebalance: 24, invert: true },
  { name: 'REV lb72/top2', lookback: 72, skip: 0, top: 2, rebalance: 24, invert: true },
  { name: 'REV lb90/top2', lookback: 90, skip: 0, top: 2, rebalance: 24, invert: true },
  { name: 'REV lb120/top2', lookback: 120, skip: 0, top: 2, rebalance: 24, invert: true },
  // Breadth: concentration is the other axis that overfits easily.
  { name: 'REV lb72/top1', lookback: 72, skip: 0, top: 1, rebalance: 24, invert: true },
  { name: 'REV lb72/top3', lookback: 72, skip: 0, top: 3, rebalance: 24, invert: true },
  { name: 'REV lb72/top4', lookback: 72, skip: 0, top: 4, rebalance: 24, invert: true },
  { name: 'REV lb72/top5', lookback: 72, skip: 0, top: 5, rebalance: 24, invert: true },
  // Rebalance cadence.
  { name: 'REV lb72/top2 reb12', lookback: 72, skip: 0, top: 2, rebalance: 12, invert: true },
  { name: 'REV lb72/top2 reb48', lookback: 72, skip: 0, top: 2, rebalance: 48, invert: true },
];

const source = new KrakenPublicSource();
const inst = await source.getInstruments();
if (!inst.ok) throw new Error('no instruments');
const symbols = inst.value.slice(0, 10).map((i) => i.symbol);

const series = new Map<string, Candle[]>();
for (const symbol of symbols) {
  const res = await source.getCandles(symbol, TF, LIMIT);
  if (res.ok && res.value.length > 200) series.set(symbol, res.value);
  else console.error(`skip ${symbol}: ${res.ok ? res.value.length : 0} bars`);
}
if (series.size < 4) throw new Error('too few symbols to rank cross-sectionally');

/**
 * Align every symbol onto the timestamps present in ALL of them, so a ranking
 * never compares one symbol's fresh bar against another's stale one.
 */
const commonStamps = (() => {
  const lists = [...series.values()].map((cs) => new Set(cs.map((c) => c.timestamp)));
  const first = [...series.values()][0]!;
  return first.map((c) => c.timestamp).filter((t) => lists.every((s) => s.has(t)));
})();
const closes = new Map<string, number[]>();
for (const [symbol, cs] of series) {
  const byStamp = new Map(cs.map((c) => [c.timestamp, c.close]));
  closes.set(symbol, commonStamps.map((t) => byStamp.get(t)!));
}
const names = [...closes.keys()];
const N = commonStamps.length;
console.error(`loaded ${names.length} symbols, ${N} aligned ${TF} bars\n`);

/** Equal-weight buy & hold of the whole basket over [from, to) — the benchmark. */
function basketReturn(from: number, to: number): number {
  let sum = 0;
  for (const name of names) {
    const p = closes.get(name)!;
    sum += (p[to - 1]! - p[from]!) / p[from]!;
  }
  return (sum / names.length) * 100;
}

/**
 * Simulate one variant over [from, to). Holdings are quantities so they drift
 * with price between rebalances; cost is charged on the notional actually
 * traded, so a rebalance that does not change the selection costs nothing.
 */
function simulate(v: Variant, from: number, to: number): { ret: number; maxDd: number; rebalances: number } {
  const need = v.lookback + v.skip;
  const start = Math.max(from, need);
  if (to - start < 2) return { ret: 0, maxDd: 0, rebalances: 0 };

  let cash = INITIAL;
  const qty = new Map<string, number>();
  let peak = INITIAL;
  let maxDd = 0;
  let rebalances = 0;

  const equityAt = (i: number): number => {
    let total = cash;
    for (const [name, q] of qty) total += q * closes.get(name)![i]!;
    return total;
  };

  for (let i = start; i < to; i++) {
    if ((i - start) % v.rebalance === 0) {
      // Rank on returns that ended `skip` bars ago — no bar at or after `i` is
      // consulted, so the ranking cannot see the move it is meant to predict.
      const scored = names
        .map((name) => {
          const p = closes.get(name)!;
          const end = i - v.skip;
          const begin = end - v.lookback;
          return { name, mom: (p[end - 1]! - p[begin]!) / p[begin]! };
        })
        .sort((a, b) => (v.invert ? a.mom - b.mom : b.mom - a.mom));
      const chosen = new Set(scored.slice(0, v.top).map((s) => s.name));

      const equity = equityAt(i);
      const target = equity / v.top;
      let traded = 0;
      for (const name of names) {
        const price = closes.get(name)![i]!;
        const held = (qty.get(name) ?? 0) * price;
        const want = chosen.has(name) ? target : 0;
        traded += Math.abs(want - held);
        if (want === 0) qty.delete(name);
        else qty.set(name, want / price);
      }
      cash = equity - [...qty].reduce((s, [n, q]) => s + q * closes.get(n)![i]!, 0) - traded * COST;
      rebalances++;
    }
    const eq = equityAt(i);
    peak = Math.max(peak, eq);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }

  return { ret: ((equityAt(to - 1) - INITIAL) / INITIAL) * 100, maxDd, rebalances };
}

const foldSize = Math.floor(N / FOLDS);
const n = (v: number, w = 8): string => v.toFixed(2).padStart(w);

console.log(
  `Cross-sectional relative strength — ${names.length} symbols, ${N} aligned ${TF} bars, ` +
    `${FOLDS} folds, cost ${COST * 100}%/side`,
);
console.log(`Bar to clear: beat the equal-weight basket in EVERY fold (not just overall).\n`);
console.log(
  'variant'.padEnd(24) +
    ['f1 ret', 'f2 ret', 'f3 ret', 'beat', 'all ret', 'basket', 'edge', 'maxDD'].map((h) => h.padStart(8)).join(''),
);
console.log('-'.repeat(24 + 8 * 8));

const foldBasket = Array.from({ length: FOLDS }, (_, f) =>
  basketReturn(f * foldSize, (f + 1) * foldSize),
);
const allBasket = basketReturn(0, N);

for (const v of VARIANTS) {
  const folds = Array.from({ length: FOLDS }, (_, f) => simulate(v, f * foldSize, (f + 1) * foldSize));
  const all = simulate(v, 0, N);
  const beat = folds.filter((r, f) => r.ret > foldBasket[f]!).length;
  console.log(
    v.name.padEnd(24) +
      folds.map((r) => n(r.ret)).join('') +
      `${beat}/${FOLDS}`.padStart(8) +
      n(all.ret) +
      n(allBasket) +
      n(all.ret - allBasket) +
      n(all.maxDd),
  );
}
console.log('-'.repeat(24 + 8 * 8));
console.log(
  `basket per fold: ${foldBasket.map((b) => b.toFixed(2)).join('%, ')}%  ·  overall ${allBasket.toFixed(2)}%`,
);
