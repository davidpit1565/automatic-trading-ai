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
import { buildTopTraderGate } from '../src/core/signal/topTraderGate';
import { getTopTraderPositionRatio, toOkxSwapInstId, type TopTraderRatioPoint } from '../src/core/data/okxPositioning';
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
  /** Scales risk-per-trade with signal confidence (riskEngine.ts) — omit to leave it off. */
  confidenceRisk?: { floorPct: number; ceilingPct: number };
  /**
   * Daily-EMA period for a MARKET-WIDE regime gate built from BTC's own
   * daily trend, applied to every symbol's entry (including BTC's) — distinct
   * from `regimePeriod` (each symbol judged on its OWN daily trend). Omit to
   * leave it off.
   */
  marketRegimePeriod?: number;
  /** Blocks entries when OKX's top traders are net-short that asset (topTraderGate.ts) — omit to leave it off. */
  topTraderGate?: boolean;
  /** Partial override on top of DEFAULT_RISK_LIMITS — e.g. to test a looser maxTotalExposurePct. */
  riskLimits?: Partial<typeof DEFAULT_RISK_LIMITS>;
  /** Hold-through-trend exit (paperAutoPilot.ts's trendExit) — replaces the
   * fixed take-profit with "close below a trailing EMA". Omit for the
   * existing fixed-target behaviour. */
  trendExit?: { emaPeriod: number };
}
const CONFIGS: Cfg[] = [
  { name: 'PROD (40/65/1.5-1.5)', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 20            ', minConfidence: 20, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 30            ', minConfidence: 30, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  { name: 'floor 50            ', minConfidence: 50, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 } },
  // Finer floor granularity between the measured 40 and the too-sparse 50,
  // now against the true current baseline (no trail — see 'fixed stop (no
  // trail)' below, adopted 2026-08-27): is there a floor that raises win
  // rate further than 40 without starving the sample the way 50 does?
  { name: 'floor 40 no-trail (TRUE PROD)', minConfidence: 40, maxRsiForLong: 65 },
  { name: 'floor 42 no-trail   ', minConfidence: 42, maxRsiForLong: 65 },
  { name: 'floor 45 no-trail   ', minConfidence: 45, maxRsiForLong: 65 },
  { name: 'floor 48 no-trail   ', minConfidence: 48, maxRsiForLong: 65 },
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
  // Confidence-scaled position sizing (riskEngine.ts's confidenceScaledRiskPct)
  // layered on top of the actual current production config (regime EMA50 is
  // already live). Stays within the existing 1% risk ceiling — a weak
  // (just-above-floor) setup risks 0.5%, a max-confidence setup risks the
  // full 1% it already got before; nothing above today's ceiling is ever
  // risked. Built but not yet wired into production until measured here.
  { name: 'PROD+regime50+confRisk .5-1', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 } },
  { name: 'PROD+confRisk .5-1  ', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 } },
  // Market-wide regime gate built from BTC's own daily trend, layered on the
  // full current production config (regime EMA50 + confidence-scaled sizing)
  // — a coin can look fine on its own chart while the market it trades
  // inside is rolling over. Distinct mechanism from the per-symbol regime
  // gate above; both can be on at once. Built but not yet wired into
  // production until measured here.
  { name: 'PROD+regime50+confRisk+BTCregime50', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50 },
  { name: 'PROD+regime50+confRisk+BTCregime100', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 100 },
  { name: 'PROD+confRisk+BTCregime50 (no sym regime)', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50 },
  // Top-trader positioning gate (OKX top traders' aggregate long/short
  // ratio, topTraderGate.ts) layered on the ACTUAL current production
  // config (regime EMA50 + confidence-scaled sizing + BTC market regime,
  // all three already live). Unlike whale-flow (Kraken trade-tape proxy,
  // no history available), OKX keeps real daily history, so this can be
  // measured here instead of shipping shadow-only. Built but not yet wired
  // into production until measured.
  { name: 'PROD+regime50+confRisk+BTCregime50+topTrader', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, topTraderGate: true },
  { name: 'PROD+topTrader only (isolates its own contribution)', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, topTraderGate: true },
  // Loosening one knob at a time on top of the EXACT config actually running
  // in production today (regime EMA50 + confRisk .5-1 — same as the row
  // above named 'PROD+regime50+confRisk .5-1'), to see whether any of it
  // can close some of the real-money-readiness benchmark's BTC gap without
  // dropping the other measured protections. Each isolates one variable
  // against that same baseline row.
  { name: 'PROD+regime50+confRisk + rsi75', minConfidence: 40, maxRsiForLong: 75, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 } },
  { name: 'PROD+regime50+confRisk + trail 2.5/2.5', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 2.5, trailR: 2.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 } },
  { name: 'PROD+regime50+confRisk + exposure80', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, riskLimits: { maxTotalExposurePct: 80 } },
  // The exposure-cap widening above was adopted into production 2026-08-21
  // (see paperAutoPilot.ts's AUTOPILOT_RISK_LIMITS). The TRUE current
  // production config is regime EMA50 + confRisk .5-1 + BTC market regime
  // EMA50 + that 80% exposure cap — this row matches it exactly, as the
  // fair baseline for the next knob (maxOpenPositions, below).
  { name: 'PROD live (regime50+confRisk+BTCregime50+exposure80)', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80 } },
  // Same exact config, position-count cap raised 5→8 (the audit log shows
  // real same-day refusals of otherwise-qualifying SOL/ETH setups purely on
  // "maximum open positions reached (5/5)", not signal quality) — does more
  // concurrent (smaller, since per-position/per-asset caps are unchanged)
  // positions actually help, or does the extra concentration hurt more than
  // it captures?
  { name: 'PROD live + maxOpenPositions 8', minConfidence: 40, maxRsiForLong: 65, trailing: { activateR: 1.5, trailR: 1.5 }, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80, maxOpenPositions: 8 } },
  // TRUE current production (2026-08-27: AUTOPILOT_TRAILING measured off,
  // see paperAutoPilot.ts's own dated comment) — every row above this one
  // still hardcodes the old trailing 1.5/1.5, so none of them reflect what
  // is actually live today. This is the real baseline for the trend-exit
  // question David asked: does trend-exit (hold through trend, no fixed
  // take-profit) beat the current no-trail fixed-target config?
  { name: 'PROD live (no trail, current)', minConfidence: 40, maxRsiForLong: 65, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80 } },
  { name: 'PROD live + trend-exit EMA10', minConfidence: 40, maxRsiForLong: 65, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80 }, trendExit: { emaPeriod: 10 } },
  { name: 'PROD live + trend-exit EMA20', minConfidence: 40, maxRsiForLong: 65, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80 }, trendExit: { emaPeriod: 20 } },
  { name: 'PROD live + trend-exit EMA50', minConfidence: 40, maxRsiForLong: 65, regimePeriod: 50, confidenceRisk: { floorPct: 0.5, ceilingPct: 1 }, marketRegimePeriod: 50, riskLimits: { maxTotalExposurePct: 80 }, trendExit: { emaPeriod: 50 } },
];

const source = new KrakenPublicSource();
const inst = await source.getInstruments();
if (!inst.ok) throw new Error('no instruments');
const symbols = inst.value.slice(0, 10).map((i) => i.symbol);
const btcSymbol = symbols.find((s) => /XBT|BTC/i.test(s));
if (!btcSymbol) throw new Error('no BTC symbol in the measured universe');

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

/** OKX top-trader position ratio per symbol, fetched once (~100 real daily points). */
async function loadTopTraderRatios(): Promise<Map<string, TopTraderRatioPoint[]>> {
  const r = new Map<string, TopTraderRatioPoint[]>();
  for (const s of symbols) {
    const instId = toOkxSwapInstId(s);
    if (!instId) continue;
    const res = await getTopTraderPositionRatio(instId, '1D', 100);
    if (res.ok) r.set(s, res.value);
    else console.error(`  fetch failed OKX top-trader ratio ${s} (${instId}): ${res.error}`);
  }
  return r;
}

async function replay(
  cfg: Cfg,
  e: Map<string, Candle[]>,
  c: Map<string, Candle[]>,
  stamps: number[],
  entryTf: Timeframe,
  confirmTf: Timeframe,
  daily: Map<string, Candle[]>,
  topTraderRatios: Map<string, TopTraderRatioPoint[]>,
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
  const btcDaily = daily.get(btcSymbol);
  const marketRegimeFilter =
    cfg.marketRegimePeriod && btcDaily
      ? buildDailyRegimeFilter(btcDaily, { period: cfg.marketRegimePeriod })
      : null;
  const topTraderGates = cfg.topTraderGate
    ? new Map([...topTraderRatios.entries()].map(([s, points]) => [s, buildTopTraderGate(points)]))
    : null;
  const pilot = new PaperAutoPilot({
    source: src, symbols, timeframe: entryTf, confirmationTimeframe: confirmTf,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio, positions, killSwitch: new PersistedKillSwitch(store), audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0, costRate: COST, minConfidence: cfg.minConfidence,
    maxRsiForLong: cfg.maxRsiForLong, trailing: cfg.trailing, trendExit: cfg.trendExit,
    riskLimits: cfg.riskLimits ? { ...DEFAULT_RISK_LIMITS, ...cfg.riskLimits } : DEFAULT_RISK_LIMITS,
    ...(cfg.evaluate ? { evaluate: cfg.evaluate } : {}),
    ...(regimeFilters ? { regimeCheck: async (s: string, ts: number) => regimeFilters.get(s)?.(ts) ?? true } : {}),
    ...(marketRegimeFilter ? { marketRegimeCheck: async (ts: number) => marketRegimeFilter(ts) } : {}),
    ...(topTraderGates ? { topTraderCheck: async (s: string, ts: number) => topTraderGates.get(s)?.(ts) ?? true } : {}),
    ...(cfg.confidenceRisk ? { confidenceRisk: cfg.confidenceRisk } : {}),
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
  return { ret: ((equity - CASH) / CASH) * 100, dd: a.maxDrawdownPct, pf: a.profitFactor, n: a.tradeCount, win: a.winRatePct };
}

const daily = await loadDaily();
const topTraderRatios = await loadTopTraderRatios();

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
  let bhSum = 0, bhN = 0, btcBh: number | null = null;
  for (const s of symbols) {
    const series = e.get(s);
    if (!series || series.length < WARMUP + 2) continue;
    const w = series.slice(WARMUP);
    const ret = ((w[w.length - 1]!.close - w[0]!.close) / w[0]!.close) * 100;
    bhSum += ret;
    bhN++;
    if (s === btcSymbol) btcBh = ret;
  }
  console.log(`\n=== ${label} (${usable.length} bars) ===`);
  console.log(`buy & hold, 10-asset basket mean: ${(bhSum / bhN).toFixed(2)}% (${bhN} majors)`);
  // The real-money-readiness gate's own "benchmark" criterion compares
  // against BTC specifically, not the basket — this is the number that
  // actually needs to be beaten for that criterion to pass.
  console.log(`buy & hold, BTC only:              ${btcBh === null ? 'n/a' : btcBh.toFixed(2) + '%'}`);
  console.log('config                  |   full ret |  full PF |  win% | trades |  OOS ret | OOS PF |  OOS win%');
  // profitFactor is `null` from tradeAnalytics whenever there were zero
  // losing trades (grossLoss === 0) — undefined, not zero. Printing that as
  // "0.000" reads as the worst possible score when it's actually the best
  // (every trade was a winner); render it as '∞' instead so the sweep output
  // can't be misread backwards.
  const fmtPf = (pf: number | null, n: number): string => (pf === null ? (n > 0 ? '∞' : '-') : pf.toFixed(3));
  for (const cfg of CONFIGS) {
    const full = await replay(cfg, e, c, usable, entryTf, confirmTf, daily, topTraderRatios);
    const oos = await replay(cfg, e, c, usable.slice(mid), entryTf, confirmTf, daily, topTraderRatios);
    const fmtWin = (w: number | null): string => (w === null ? '-' : w.toFixed(1));
    console.log(
      `${cfg.name} | ${full.ret.toFixed(3).padStart(9)}% | ${fmtPf(full.pf, full.n).padStart(8)} | ${fmtWin(full.win).padStart(5)} | ${String(full.n).padStart(6)} | ${oos.ret.toFixed(3).padStart(7)}% | ${fmtPf(oos.pf, oos.n).padStart(6)} | ${fmtWin(oos.win).padStart(9)}`,
    );
  }
}
