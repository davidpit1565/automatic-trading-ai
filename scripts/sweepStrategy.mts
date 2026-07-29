/**
 * Strategy parameter sweep — measures candidate decision-logic configs against
 * the current baseline on REAL Kraken history, so improvements are proven, not
 * guessed. Fetches each symbol's candles ONCE, then replays every config.
 *
 * Run: npx tsx scripts/sweepStrategy.mts
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { runLivePipelineBacktest, type LivePipelineTrade } from '../src/core/backtest/livePipeline';
import type { SignalCriteria } from '../src/core/signal/signalEngine';
import type { Candle } from '../src/core/types';

const BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'DOT', 'LINK', 'AVAX'];
const LIMIT = 720;

interface Config {
  readonly name: string;
  readonly criteria?: Partial<SignalCriteria>;
  readonly minConfidence?: number;
  readonly confirmation?: boolean; // apply 4h higher-timeframe gate
  readonly trailing?: { activateR: number; trailR: number };
}

/**
 * Configs driven by the live journal's diagnosis (24 closed trades, PF 0.34):
 *   - Realized R:R is 1.16:1 while a 21% win rate needs 3.80:1 to break even.
 *   - Only 1 of 24 trades ever reached the trailing stop's 1.5R arming
 *     threshold, so the trailing stop is effectively dead in production.
 *   - The 4×ATR target is rarely reached while the 2×ATR stop is hit 19/24.
 * So the grid attacks the EXIT side: when the trail arms, and how far the
 * target sits — not more variants of the entry signal (the earlier sweep
 * already showed nearby entry settings all lose).
 */
const PROD = { maxRsiForLong: 65 };
const CONFIGS: Config[] = [
  { name: 'PROD baseline (live today)', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'PROD no trail (control)', criteria: PROD, minConfidence: 20, confirmation: true },
  // H1: arm the trail where favourable excursions actually peak.
  { name: 'trail 0.4/0.4', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 0.4, trailR: 0.4 } },
  { name: 'trail 0.5/0.5', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
  { name: 'trail 0.6/0.6', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 0.6, trailR: 0.6 } },
  { name: 'trail 0.6/1.0', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 0.6, trailR: 1 } },
  { name: 'trail 0.8/0.8', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 0.8, trailR: 0.8 } },
  { name: 'trail 1.0/1.0', criteria: PROD, minConfidence: 20, confirmation: true, trailing: { activateR: 1, trailR: 1 } },
  // H2: fix the payoff — a 21% win rate cannot pay for a 2:1 design.
  { name: 'target 6R fixed stop', criteria: { ...PROD, atrTargetMultiple: 6 }, minConfidence: 20, confirmation: true },
  { name: 'target 8R fixed stop', criteria: { ...PROD, atrTargetMultiple: 8 }, minConfidence: 20, confirmation: true },
  { name: 'target 3R fixed stop', criteria: { ...PROD, atrTargetMultiple: 3 }, minConfidence: 20, confirmation: true },
  // H3: let winners run AND protect them — the combination, not either alone.
  { name: 'target 6R + trail 0.5/0.5', criteria: { ...PROD, atrTargetMultiple: 6 }, minConfidence: 20, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
  { name: 'target 6R + trail 0.6/1.0', criteria: { ...PROD, atrTargetMultiple: 6 }, minConfidence: 20, confirmation: true, trailing: { activateR: 0.6, trailR: 1 } },
  { name: 'target 8R + trail 0.5/0.5', criteria: { ...PROD, atrTargetMultiple: 8 }, minConfidence: 20, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
  { name: 'target 8R + trail 0.6/1.0', criteria: { ...PROD, atrTargetMultiple: 8 }, minConfidence: 20, confirmation: true, trailing: { activateR: 0.6, trailR: 1 } },
  // H4: tighter stop widens R:R for free — if it does not just stop out more.
  { name: 'stop 1.5R target 6R', criteria: { ...PROD, atrStopMultiple: 1.5, atrTargetMultiple: 6 }, minConfidence: 20, confirmation: true },
  { name: 'stop 2.5R target 8R', criteria: { ...PROD, atrStopMultiple: 2.5, atrTargetMultiple: 8 }, minConfidence: 20, confirmation: true },
  // H5: costs are 71% of the live loss — does trading less help net of fees?
  { name: 'conf 35 + trail 0.5/0.5', criteria: PROD, minConfidence: 35, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
  { name: 'conf 35 target 6R trail 0.5', criteria: { ...PROD, atrTargetMultiple: 6 }, minConfidence: 35, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
  { name: 'conf 50 target 6R trail 0.5', criteria: { ...PROD, atrTargetMultiple: 6 }, minConfidence: 50, confirmation: true, trailing: { activateR: 0.5, trailR: 0.5 } },
];

async function main(): Promise<void> {
  const source = new KrakenPublicSource();
  const instruments = await source.getInstruments();
  if (!instruments.ok) {
    console.error('Could not load instruments:', instruments.error);
    process.exit(1);
  }
  // Fetch each symbol's 1h + 4h candles ONCE.
  const data: { symbol: string; base: string; h1: Candle[]; h4: Candle[]; bh: number }[] = [];
  for (const base of BASES) {
    const inst = instruments.value.find((i) => i.base.toUpperCase() === base);
    if (!inst) { console.error(`skip ${base}: no instrument`); continue; }
    const h1 = await source.getCandles(inst.symbol, '1h', LIMIT);
    const h4 = await source.getCandles(inst.symbol, '4h', LIMIT);
    if (!h1.ok || h1.value.length < 200) { console.error(`skip ${base}: 1h fetch`); continue; }
    const closes = h1.value;
    const bh = ((closes[closes.length - 1]!.close - closes[0]!.close) / closes[0]!.close) * 100;
    data.push({ symbol: inst.symbol, base, h1: closes, h4: h4.ok ? h4.value : [], bh });
    console.error(`fetched ${base}: ${closes.length} 1h, ${h4.ok ? h4.value.length : 0} 4h`);
  }
  if (data.length === 0) { console.error('no data'); process.exit(1); }

  const bhMean = data.reduce((s, d) => s + d.bh, 0) / data.length;

  interface Row { name: string; retMean: number; ddMean: number; trades: number; winPct: number; pf: number; oosPf: number; }
  const rows: Row[] = [];
  const pooledPf = (h1slice: (c: Candle[]) => Candle[]): ((cfg: Config) => { pf: number }) =>
    (cfg) => {
      let gp = 0, gl = 0;
      for (const d of data) {
        const res = runLivePipelineBacktest(h1slice(d.h1), {
          symbol: d.symbol, timeframe: '1h', costRate: 0.003,
          minConfidence: cfg.minConfidence, criteria: cfg.criteria,
          higherCandles: cfg.confirmation ? d.h4 : undefined,
          confirmationTimeframe: '4h', trailing: cfg.trailing,
        });
        for (const t of res.closedTrades as LivePipelineTrade[]) {
          if (t.pnl > 0) gp += t.pnl; else gl += -t.pnl;
        }
      }
      return { pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0 };
    };
  // Out-of-sample = the second half of each series (not the window configs were
  // eyeballed on) — a fake "improvement" that only fits the past dies here.
  const oos = pooledPf((c) => c.slice(Math.floor(c.length / 2)));

  for (const cfg of CONFIGS) {
    let retSum = 0, ddSum = 0, trades = 0, wins = 0, grossProfit = 0, grossLoss = 0;
    for (const d of data) {
      const res = runLivePipelineBacktest(d.h1, {
        symbol: d.symbol,
        timeframe: '1h',
        costRate: 0.003,
        minConfidence: cfg.minConfidence,
        criteria: cfg.criteria,
        higherCandles: cfg.confirmation ? d.h4 : undefined,
        confirmationTimeframe: '4h',
        trailing: cfg.trailing,
      });
      retSum += res.totalReturnPct;
      ddSum += res.maxDrawdownPct;
      trades += res.closedTrades.length;
      for (const t of res.closedTrades as LivePipelineTrade[]) {
        if (t.pnl > 0) { wins++; grossProfit += t.pnl; } else { grossLoss += -t.pnl; }
      }
    }
    rows.push({
      name: cfg.name,
      retMean: retSum / data.length,
      ddMean: ddSum / data.length,
      trades,
      winPct: trades > 0 ? (wins / trades) * 100 : 0,
      pf: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      oosPf: oos(cfg).pf,
    });
  }

  // Sort by profit factor desc, then return desc.
  rows.sort((a, b) => (b.pf - a.pf) || (b.retMean - a.retMean));

  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (v: number, n: number) => v.toFixed(n).padStart(8);
  console.log(`\nSweep over ${data.length} symbols, ${LIMIT} 1h candles each. Buy&hold mean: ${bhMean.toFixed(2)}%`);
  console.log(`(after fees 0.3%/side; sorted by profit factor)\n`);
  console.log(pad('Config', 34) + num2('Ret%') + num2('MaxDD%') + '  Trades' + '   Win%' + '     PF' + '  OOS-PF');
  console.log('-'.repeat(86));
  for (const r of rows) {
    console.log(
      pad(r.name, 34) + num(r.retMean, 2) + num(r.ddMean, 2) +
      String(r.trades).padStart(8) + num(r.winPct, 1) + num(r.pf === Infinity ? 999 : r.pf, 2) +
      num(r.oosPf === Infinity ? 999 : r.oosPf, 2),
    );
  }
  console.log('-'.repeat(78));
  console.log(`Buy & hold mean return: ${bhMean.toFixed(2)}%  (context: a stop-based long strategy trades upside for smaller drawdown)`);
}

function num2(s: string): string { return s.padStart(8); }

void main();
