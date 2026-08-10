/**
 * Parameter sweep on the REAL autopilot.
 *
 * Unlike `sweepStrategy.mts` (which drives `runLivePipelineBacktest` — a
 * per-symbol approximation with intrabar exits), this replays the actual
 * `PaperAutoPilot`: one shared account, real risk limits, close-based exits.
 * See the warning at the top of `livePipeline.ts` for why that distinction
 * changes conclusions.
 *
 * Reports each config over two entry timeframes, so a winner has to survive
 * both, and splits in-sample / out-of-sample so a config that merely fits the
 * past dies. Buy-and-hold over the same window is printed alongside: a
 * long-only strategy in a falling market must be judged against it, not only
 * against zero.
 *
 * Run: npx tsx scripts/sweepAutopilot.mts   (several minutes — full replays)
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { MemoryStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { PaperAutoPilot } from '../src/core/autopilot/paperAutoPilot';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { PositionEngine } from '../src/core/position/positionEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { tradeAnalytics } from '../src/core/position/analytics';
import { drawdownBreached } from '../src/core/risk/drawdownBreaker';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import { meanReversionSignal, breakoutSignal } from '../src/core/signal/alternativeSignals';
import { buildDailyRegimeFilter } from '../src/core/signal/regimeFilter';
import type { ScanResult } from '../src/core/scan/marketScanner';
import type { SignalDecision } from '../src/core/signal/signalEngine';
import type { Candle, Timeframe } from '../src/core/types';
import { ok } from '../src/core/types';

const CASH = 10_000, COST = 0.003, DD = 8, WARMUP = 150;
interface Cfg {
  name: string;
  minConfidence: number;
  maxRsiForLong: number;
  trailing?: { activateR: number; trailR: number };
  /** A different signal FAMILY, not a different setting of the same one. */
  evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  /** Daily-EMA period for the regime gate (regimeFilter.ts) — omit to leave it off. */
  regimePeriod?: number;
}
const CONFIGS: Cfg[] = [
  { name: 'PROD (40/65/1.5-1.5)', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 20            ', minConfidence: 20, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 30            ', minConfidence: 30, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 50            ', minConfidence: 50, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'rsi 55              ', minConfidence: 40, maxRsiForLong: 55, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'rsi 75              ', minConfidence: 40, maxRsiForLong: 75, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'fixed stop (no trail)', minConfidence: 40, maxRsiForLong: 65 },
  { name: 'trail 1.0/2.0       ', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1, trailR: 2 } },
  // Different IDEAS. Floors are 0 because these signals score on their own
  // scale; the production floor would silently mute them.
  { name: 'MEAN-REVERSION      ', minConfidence: 0, maxRsiForLong: 100, trailing: { activateR: 1.5, trailR: 1.5 }, evaluate: meanReversionSignal },
  { name: 'BREAKOUT            ', minConfidence: 0, maxRsiForLong: 100, trailing: { activateR: 1.5, trailR: 1.5 }, evaluate: breakoutSignal },
  { name: 'MEAN-REV fixed stop ', minConfidence: 0, maxRsiForLong: 100, evaluate: meanReversionSignal },
  { name: 'BREAKOUT fixed stop ', minConfidence: 0, maxRsiForLong: 100, evaluate: breakoutSignal },
  // Daily regime gate (regimeFilter.ts) layered on PROD — built but never
  // wired into the live autopilot until measured. Two EMA periods, both on
  // top of the exact production config, so a comparison against the first
  // row is a clean one-variable test.
  { name: 'PROD + regime EMA50 ', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50 },
  { name: 'PROD + regime EMA100', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 100 },
  { name: 'PROD + regime EMA200', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 200 },
];

const source = new KrakenPublicSource();
const inst = await source.getInstruments();
if (!inst.ok) throw new Error('no instruments');
const symbols = inst.value.slice(0, 10).map((i) => i.symbol);

async function load(entryTf: Timeframe, confirmTf: Timeframe) {
  const e = new Map<string, Candle[]>(), c = new Map<string, Candle[]>();
  for (const s of symbols) {
    const a = await source.getCandles(s, entryTf, 720);
    const b = await source.getCandles(s, confirmTf, 720);
    if (a.ok) e.set(s, a.value);
    else console.error(`  fetch failed ${s} ${entryTf}: ${a.error}`);
    if (b.ok) c.set(s, b.value);
    else console.error(`  fetch failed ${s} ${confirmTf}: ${b.error}`);
  }
  return { e, c };
}

/** Daily candles per symbol, fetched once — every regime period reuses these. */
async function loadDaily(): Promise<Map<string, Candle[]>> {
  const d = new Map<string, Candle[]>();
  for (const s of symbols) {
    const res = await source.getCandles(s, '1d', 400);
    if (res.ok) d.set(s, res.value);
    else console.error(`  fetch failed ${s} 1d: ${res.error}`);
  }
  return d;
}

async function replay(
  cfg: Cfg,
  e: Map<string, Candle[]>,
  c: Map<string, Candle[]>,
  stamps: number[],
  entryTf: Timeframe,
  confirmTf: Timeframe,
  daily: Map<string, Candle[]>,
) {
  let clock = 0;
  const src: MarketDataSource = {
    name: 'r',
    getInstruments: async () => ok(symbols.map((s) => ({ symbol: s, base: s, quote: 'EUR' }))),
    getCandles: async (s, tf, lim) => ok(((tf === confirmTf ? c : e).get(s) ?? []).filter((x) => x.timestamp <= clock).slice(-lim)),
  };
  const store = new MemoryStore(), journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: CASH, baseCurrency: 'EUR' });
  let peak = CASH, equity = CASH;
  const regimeFilters = cfg.regimePeriod
    ? new Map(
        [...daily.entries()].map(([s, candles]) => [s, buildDailyRegimeFilter(candles, { period: cfg.regimePeriod! })]),
      )
    : null;
  const pilot = new PaperAutoPilot({
    source: src, symbols, timeframe: entryTf, confirmationTimeframe: confirmTf,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio, positions, killSwitch: new PersistedKillSwitch(store), audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0, costRate: COST, minConfidence: cfg.minConfidence,
    maxRsiForLong: cfg.maxRsiForLong, trailing: cfg.trailing, riskLimits: DEFAULT_RISK_LIMITS,
    ...(cfg.evaluate ? { evaluate: cfg.evaluate } : {}),
    ...(regimeFilters ? { regimeCheck: async (s: string, ts: number) => regimeFilters.get(s)?.(ts) ?? true } : {}),
    haltNewEntries: () => drawdownBreached({ peakEquity: peak, currentEquity: equity, maxDrawdownPct: DD }),
  });
  for (const t of stamps) {
    clock = t;
    await pilot.runCycleOnce(t);
    const prices: Record<string, number> = {};
    for (const p of portfolio.openPositions()) {
      const s = e.get(p.symbol) ?? [];
      for (let i = s.length - 1; i >= 0; i--) if (s[i]!.timestamp <= t) { prices[p.symbol] = s[i]!.close; break; }
    }
    equity = portfolio.snapshot(prices, t).equity;
    peak = Math.max(peak, equity);
  }
  const a = tradeAnalytics(journal.entries(), { initialCash: CASH });
  return { ret: ((equity - CASH) / CASH) * 100, dd: a.maxDrawdownPct, pf: a.profitFactor, n: a.tradeCount };
}

const daily = await loadDaily();

for (const [entryTf, confirmTf, label] of [['1h', '4h', '1h entry / 30 days'], ['4h', '1d', '4h entry / 120 days']] as const) {
  const { e, c } = await load(entryTf, confirmTf);
  // Any symbol can fail to fetch transiently, so anchor the timeline on the
  // longest series we actually got rather than assuming the first one loaded.
  const ref = [...e.values()].sort((a, b) => b.length - a.length)[0];
  if (!ref || ref.length <= WARMUP) {
    console.error(`skipping ${label}: not enough history fetched`);
    continue;
  }
  const usable = ref.slice(WARMUP).map((x) => x.timestamp);
  const mid = Math.floor(usable.length / 2);
  let bhSum = 0, bhN = 0;
  for (const s of symbols) {
    const series = e.get(s);
    if (!series || series.length < WARMUP + 2) continue;
    const w = series.slice(WARMUP);
    bhSum += ((w[w.length - 1]!.close - w[0]!.close) / w[0]!.close) * 100;
    bhN++;
  }
  console.log(`\n=== ${label} (${usable.length} bars) ===`);
  console.log(`buy & hold over the same window: ${(bhSum / bhN).toFixed(2)}% (mean of ${bhN} majors)`);
  console.log('config                  |   full ret |  full PF | trades |  OOS ret | OOS PF');
  for (const cfg of CONFIGS) {
    const full = await replay(cfg, e, c, usable, entryTf, confirmTf, daily);
    const oos = await replay(cfg, e, c, usable.slice(mid), entryTf, confirmTf, daily);
    console.log(
      `${cfg.name} | ${full.ret.toFixed(3).padStart(9)}% | ${(full.pf ?? 0).toFixed(3).padStart(8)} | ${String(full.n).padStart(6)} | ${oos.ret.toFixed(3).padStart(7)}% | ${(oos.pf ?? 0).toFixed(3)}`,
    );
  }
}
