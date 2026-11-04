import { readFileSync, existsSync } from 'node:fs';
import { runLivePipelineBacktest, type LivePipelineTrade } from '../../src/core/backtest/livePipeline';
import { DEFAULT_RISK_LIMITS } from '../../src/core/risk/riskEngine';
import { buildDailyRegimeFilter } from '../../src/core/signal/regimeFilter';
import type { Candle } from '../../src/core/types';
const DIR = process.env.HIST_DIR ?? './research/hourly-3y/data';
const coins = (process.env.COINS ?? 'BTC').split(',');
const PROD = { maxRsiForLong: 65 };
const CFGS: Record<string, { stop?: number; tgt?: number; mc: number; trail?: { activateR: number; trailR: number } }> = {
  prod40: { mc: 40 }, prod30: { mc: 30 }, prod20: { mc: 20 },
  t1: { mc: 30, tgt: 1 }, t2: { mc: 30, tgt: 2 }, t3: { mc: 30, tgt: 3 }, t6: { mc: 30, tgt: 6 },
  trail: { mc: 30, trail: { activateR: 1, trailR: 1 } },
};
const cfgName = process.env.CFG ?? 'prod30';
const cost = Number(process.env.COST ?? 0.003);
const cfg = CFGS[cfgName]!;
function load(c: string): Candle[] {
  const f = `${DIR}/${c}.json`; if (!existsSync(f)) return [];
  const rows = JSON.parse(readFileSync(f, 'utf8')) as number[][];
  return rows.map((r) => ({ timestamp: r[0]! * 1000, open: r[3]!, high: r[2]!, low: r[1]!, close: r[4]!, volume: r[5]! })).sort((a, b) => a.timestamp - b.timestamp);
}
function agg4h(c: Candle[]): Candle[] {
  const span = 4 * 3600_000; const m = new Map<number, Candle[]>();
  for (const x of c) { const b = x.timestamp - (x.timestamp % span); (m.get(b) ?? m.set(b, []).get(b)!).push(x); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).filter(([, g]) => g.length === 4).map(([b, g]) => ({ timestamp: b, open: g[0]!.open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[3]!.close, volume: g.reduce((s, x) => s + x.volume, 0) }));
}
function aggN(c: Candle[], span: number): Candle[] {
  const m = new Map<number, Candle[]>();
  for (const x of c) { const b = x.timestamp - (x.timestamp % span); (m.get(b) ?? m.set(b, []).get(b)!).push(x); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).filter(([, g]) => g.length === 24).map(([b, g]) => ({ timestamp: b, open: g[0]!.open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1]!.close, volume: g.reduce((s, x) => s + x.volume, 0) }));
}
const out: { coin: string; chunk: number; n: number; w: number; gp: number; gl: number; net: number }[] = [];
const t0 = Date.now();
for (const c of coins) {
  const h1 = load(c); if (h1.length < 1000) continue; const h4 = agg4h(h1);
  const daily = process.env.REGIME ? aggN(h1, 24 * 3600_000) : [];
  const regime = process.env.REGIME ? buildDailyRegimeFilter(daily, { period: Number(process.env.REGIME) }) : undefined;
  const CH = 6; const per = Math.floor(h1.length / CH);
  for (let k = 0; k < CH; k++) {
    const slice = h1.slice(k * per, (k + 1) * per); const t1 = slice[0]!.timestamp, t2 = slice[slice.length - 1]!.timestamp;
    const hs = h4.filter((x) => x.timestamp >= t1 - 150 * 4 * 3600_000 && x.timestamp <= t2);
    const res = runLivePipelineBacktest(slice, { symbol: `${c}EUR`, timeframe: '1h', costRate: cost, minConfidence: cfg.mc,
      criteria: { ...PROD, atrStopMultiple: cfg.stop ?? 2, atrTargetMultiple: cfg.tgt ?? 4, minRiskReward: 0 }, higherCandles: hs, confirmationTimeframe: '4h',
      trailing: cfg.trail, regimeFilter: regime, riskLimits: { ...DEFAULT_RISK_LIMITS, minRewardRisk: 0 } });
    let n = 0, w = 0, gp = 0, gl = 0, net = 0;
    for (const t of res.closedTrades as LivePipelineTrade[]) { n++; net += t.pnl; if (t.pnl > 0) { w++; gp += t.pnl; } else gl -= t.pnl; }
    out.push({ coin: c, chunk: k, n, w, gp, gl, net });
  }
  console.error(`${c} done ${(Date.now() - t0) / 1000}s`);
}
console.log(JSON.stringify({ cfg: cfgName, cost, out }));
