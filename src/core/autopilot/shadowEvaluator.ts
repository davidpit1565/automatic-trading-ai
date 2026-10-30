/**
 * Shadow evaluation — forward-testing candidate strategies for free.
 *
 * The measured finding that motivated this: no parameter setting of the
 * current signal has a positive edge, and sweeping a 30-day window to find one
 * is how you manufacture an illusion that dies on real money. The honest
 * alternative is FORWARD testing — let candidates decide on live data as it
 * arrives, and judge them on a record they could not have been fitted to.
 *
 * Each candidate runs a full `PaperAutoPilot` cycle against its OWN portfolio,
 * positions, journal and audit log, namespaced inside the same state file. No
 * candidate can see or disturb another, or the real account.
 *
 * Costs nothing extra in requests: every candidate reads through one
 * `CachingSource`, so N candidates issue the requests of one.
 *
 * NOTHING HERE TRADES. `PaperAutoPilot` is simulated by construction, and a
 * shadow is a simulation of a simulation — it exists only to produce an honest
 * scoreboard.
 */

import type { KeyValueStore } from '../data/storage';
import { PrefixedStore } from '../data/prefixedStore';
import type { CachingSource } from '../data/cachingSource';
import { PortfolioEngine } from '../position/portfolioEngine';
import { PositionEngine } from '../position/positionEngine';
import { TradeJournal } from '../position/tradeJournal';
import { tradeAnalytics } from '../position/analytics';
import { DEFAULT_RISK_LIMITS, type RiskLimits } from '../risk/riskEngine';
import type { TrailingConfig } from '../risk/trailingStop';
import type { ScanResult } from '../scan/marketScanner';
import type { SignalCriteria, SignalDecision } from '../signal/signalEngine';
import { breakoutSignal, meanReversionSignal } from '../signal/alternativeSignals';
import type { Timeframe } from '../types';
import { PersistedAuditLog } from './auditLog';
import { PersistedKillSwitch } from './killSwitch';
import { AUTOPILOT_TRAILING, PaperAutoPilot } from './paperAutoPilot';

export interface ShadowCandidate {
  /** Stable storage namespace — changing it restarts that candidate's record. */
  readonly key: string;
  /** Human-readable, for the scoreboard. */
  readonly label: string;
  readonly minConfidence: number;
  readonly maxRsiForLong: number;
  /** Omit for a fixed stop. */
  readonly trailing?: TrailingConfig;
  /** Omit to skip higher-timeframe confirmation entirely. */
  readonly confirmationTimeframe?: Timeframe;
  /**
   * A different entry signal FAMILY. Omit to use the production signal.
   * This is what lets a genuinely different idea accumulate a forward record
   * beside the incumbent, on the same bars, judged on the same risk terms.
   */
  readonly evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  /**
   * Opts into `ShadowRunOptions.whaleFlowCheck` for this candidate only —
   * exactly the isolation pattern `no-confirm`/`fixed-stop` already use to
   * test what ONE gate contributes, holding everything else constant.
   */
  readonly useWhaleFlowCheck?: boolean;
  /**
   * Opts into `ShadowRunOptions.topTraderCheck` for this candidate only.
   * Unlike whale-flow, OKX's top-trader ratio DOES have real history — but
   * the available ~100-day window was too sparse (0-1 trades) in the current
   * bearish stretch to responsibly judge from a backtest alone, so this
   * accumulates a genuine forward record instead of guessing from one thin
   * sample. See `signal/topTraderGate.ts`.
   */
  readonly useTopTraderCheck?: boolean;
  /**
   * Opts into `ShadowRunOptions.fundingCheck` for this candidate only —
   * see `signal/fundingGate.ts` (David's 2026-10-04 "predict, don't just
   * look back" request).
   */
  readonly useFundingCheck?: boolean;
  /**
   * Opts into `ShadowRunOptions.aiJudgmentCheck` for this candidate only.
   * An LLM's read of the technical snapshot can NEVER be backtested (it may
   * carry hindsight of what a real historical chart actually did next), so
   * this is forward-only by construction — see `signal/aiJudgment.ts`.
   */
  readonly useAiJudgmentCheck?: boolean;
  /**
   * Decide NEW entries on closed bars only — see `PaperAutoPilotOptions.entryClosedBarsOnly`.
   * The forward test of the "live entries repaint on the forming candle" finding (2026-10-19).
   */
  readonly closedBarsOnly?: boolean;
  /**
   * Opts into `ShadowRunOptions.sentimentGate` for this candidate only — the F2
   * sentiment-trend rule (`signal/sentimentTrend.ts`) used as a market-wide entry gate.
   */
  readonly useSentimentGate?: boolean;
  /**
   * Hold-through-trend exit (see `paperAutoPilot.ts`'s own doc comment) —
   * lets a candidate represent a genuinely different HOLDING STYLE (weeks/
   * months via a slow EMA on daily bars) rather than another tight-stop
   * trading variant. Omit for the default fixed take-profit.
   */
  readonly trendExit?: { readonly emaPeriod: number };
  /**
   * Opts into `riskEngine.ts`'s correlated-cluster exposure cap
   * (`RiskLimits.correlationThreshold`/`maxCorrelatedExposurePct`) for this
   * candidate only — built and unit-tested since before this shadow existed,
   * but never wired into production (`DEFAULT_RISK_LIMITS` sets neither
   * field). Requires `ShadowRunOptions.correlationBetween`; a no-op (behaves
   * exactly like `live-mirror`) when that's unavailable.
   */
  readonly correlationCap?: { readonly threshold: number; readonly maxExposurePct: number };
  /**
   * Overrides on `DEFAULT_RISK_LIMITS` for this candidate only (position size
   * and exposure caps). Same entry signal, bigger bets: isolates what taking
   * more risk does to the forward record. Omit for the production limits.
   */
  readonly riskLimits?: Partial<RiskLimits>;
  /** Overrides on the production signal criteria, e.g. wider ATR stop/target multiples. */
  readonly signalCriteria?: Partial<SignalCriteria>;
}

export interface ShadowStanding {
  readonly key: string;
  readonly label: string;
  readonly equity: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly openPositions: number;
  /** When this candidate first ran, so age can be reported honestly. */
  readonly startedAt: number;
}

const STARTED_AT_KEY = 'shadow-started-at';

/**
 * Champion/challenger comparison now lives in its own dependency-free file
 * (`championComparison.ts`) so the UI layer's enforced import boundary
 * (`tests/ui/architecture.test.ts`) can use the real implementation instead
 * of a hand-duplicated copy — this file pulls in the full paper-trading
 * stack, which is exactly what that boundary exists to keep out of
 * presentation code. Re-exported here so every existing caller of
 * `shadowEvaluator.ts`'s `SHADOW_MEANINGFUL_TRADES`/`CHAMPION_KEY`/
 * `compareToChampion`/`ChallengerComparison` keeps working unchanged.
 */
export {
  SHADOW_MEANINGFUL_TRADES,
  CHAMPION_KEY,
  compareToChampion,
  type ChallengerComparison,
} from './championComparison';

export interface ShadowRunOptions {
  readonly source: CachingSource;
  readonly symbols: readonly string[];
  readonly timeframe: Timeframe;
  readonly initialCash: number;
  readonly costRate: number;
  readonly store: KeyValueStore;
  readonly now: number;
  /** Latest close per symbol, so equity is marked to market like the real runner. */
  readonly prices: Readonly<Record<string, number>>;
  /**
   * Built from the REAL market data source (see `whaleFlow.ts`'s doc
   * comment for why this is forward-only, not historically validated).
   * Only candidates with `useWhaleFlowCheck: true` get it wired in. Omit
   * when the real source has no trade-tape access to build it from.
   */
  readonly whaleFlowCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Built from OKX's public top-trader position ratio (see
   * `data/okxPositioning.ts`). Only candidates with `useTopTraderCheck: true`
   * get it wired in. Omit when unavailable (e.g. a fetch failure).
   */
  readonly topTraderCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Built from OKX's public funding-rate history (see `data/okxFunding.ts`).
   * Only candidates with `useFundingCheck: true` get it wired in.
   */
  readonly fundingCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /** Market-wide entry gate for candidates with `useSentimentGate` (F2 rule says hold BTC). */
  readonly sentimentGate?: (timestamp: number) => Promise<boolean>;
  /** Symbols that get no NEW entries in any candidate (see `ENTRY_PAUSED_SYMBOLS`). */
  readonly entryPausedSymbols?: ReadonlySet<string>;
  /**
   * Built from an LLM call (see `signal/aiJudgment.ts`). Only candidates
   * with `useAiJudgmentCheck: true` get it wired in. Omit when no model API
   * key is configured — this stays a no-op (always allows) until then.
   */
  readonly aiJudgmentCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Return-correlation lookup (see `risk/correlation.ts`'s
   * `buildCorrelationMatrix`). Only candidates with `correlationCap` set get
   * it wired in. Omit when unavailable (e.g. insufficient candle history).
   */
  readonly correlationBetween?: (a: string, b: string) => number;
  /** Defaults to 'EUR' (crypto's own currency). Stocks callers pass 'USD'. */
  readonly baseCurrency?: 'EUR' | 'USD';
}

/**
 * Run one cycle for every candidate and return the standings.
 *
 * A candidate that throws is skipped with its error surfaced rather than
 * taking down the run: shadow evaluation is diagnostics, and must never be
 * able to break the real cycle that already completed.
 */
export async function runShadowCycle(
  candidates: readonly ShadowCandidate[],
  options: ShadowRunOptions,
): Promise<{ standings: ShadowStanding[]; failures: { key: string; reason: string }[] }> {
  const standings: ShadowStanding[] = [];
  const failures: { key: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    try {
      // Both of these silently merge two candidates' records if allowed
      // through — the prefix `shadow:` keeps the namespace non-empty, so the
      // store's own guard cannot catch a blank key here.
      if (candidate.key.trim() === '') throw new RangeError('candidate key must not be empty');
      if (seen.has(candidate.key)) {
        throw new RangeError(`duplicate candidate key '${candidate.key}'`);
      }
      seen.add(candidate.key);
      standings.push(await runOne(candidate, options));
    } catch (cause) {
      failures.push({
        key: candidate.key,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return { standings, failures };
}

async function runOne(
  candidate: ShadowCandidate,
  options: ShadowRunOptions,
): Promise<ShadowStanding> {
  const store = new PrefixedStore(options.store, `shadow:${candidate.key}`);
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash: options.initialCash,
    baseCurrency: options.baseCurrency ?? 'EUR',
  });

  const startedAt = store.get<number>(STARTED_AT_KEY) ?? options.now;
  store.set(STARTED_AT_KEY, startedAt);

  const pilot = new PaperAutoPilot({
    source: options.source,
    symbols: options.symbols,
    timeframe: options.timeframe,
    ...(candidate.confirmationTimeframe
      ? { confirmationTimeframe: candidate.confirmationTimeframe }
      : {}),
    // Shadows are driven one cycle at a time by the caller; they never schedule.
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    // Its own kill switch and audit log, so a shadow can never read or trip the
    // real account's emergency stop.
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0,
    costRate: options.costRate,
    minConfidence: candidate.minConfidence,
    maxRsiForLong: candidate.maxRsiForLong,
    ...(candidate.evaluate ? { evaluate: candidate.evaluate } : {}),
    ...(candidate.trailing ? { trailing: candidate.trailing } : {}),
    ...(candidate.trendExit ? { trendExit: candidate.trendExit } : {}),
    ...(candidate.useWhaleFlowCheck && options.whaleFlowCheck
      ? { whaleFlowCheck: options.whaleFlowCheck }
      : {}),
    ...(candidate.useTopTraderCheck && options.topTraderCheck
      ? { topTraderCheck: options.topTraderCheck }
      : {}),
    ...(options.entryPausedSymbols ? { entryPausedSymbols: options.entryPausedSymbols } : {}),
    ...(candidate.closedBarsOnly ? { entryClosedBarsOnly: true } : {}),
    ...(candidate.useSentimentGate && options.sentimentGate ? { marketGate: options.sentimentGate } : {}),
    ...(candidate.useFundingCheck && options.fundingCheck
      ? { fundingCheck: options.fundingCheck }
      : {}),
    ...(candidate.useAiJudgmentCheck && options.aiJudgmentCheck
      ? { aiJudgmentCheck: options.aiJudgmentCheck }
      : {}),
    ...(candidate.correlationCap && options.correlationBetween
      ? { correlationBetween: options.correlationBetween }
      : {}),
    ...(candidate.signalCriteria ? { signalCriteria: candidate.signalCriteria } : {}),
    riskLimits: {
      ...DEFAULT_RISK_LIMITS,
      ...(candidate.correlationCap
        ? {
            correlationThreshold: candidate.correlationCap.threshold,
            maxCorrelatedExposurePct: candidate.correlationCap.maxExposurePct,
          }
        : {}),
      ...candidate.riskLimits,
    },
  });

  await pilot.runCycleOnce(options.now);

  const snapshot = portfolio.snapshot(options.prices, options.now);
  const analytics = tradeAnalytics(journal.entries(), { initialCash: options.initialCash });
  return {
    key: candidate.key,
    label: candidate.label,
    equity: snapshot.equity,
    returnPct: ((snapshot.equity - options.initialCash) / options.initialCash) * 100,
    trades: analytics.tradeCount,
    winRatePct: analytics.winRatePct,
    profitFactor: analytics.profitFactor,
    openPositions: snapshot.openPositionCount,
    startedAt,
  };
}

/**
 * The candidates under forward test.
 *
 * Deliberately spread across DIFFERENT ideas rather than nearby values of the
 * same one: nearby values of a losing signal all lose, as the sweep showed.
 * `live-mirror` reproduces the production settings so the others always have a
 * like-for-like baseline running on the same bars.
 */
export const SHADOW_CANDIDATES: readonly ShadowCandidate[] = [
  // Whale-flow was promoted into REAL production 2026-09-09 (see
  // autopilotRunner.mts's main() — this candidate's own forward record
  // earned it). This candidate must include the same check, or its name
  // would be a lie: a 'live-mirror' that quietly omits a gate production
  // actually applies is measuring the wrong thing.
  // `trailing` MUST reference `AUTOPILOT_TRAILING` (not a hardcoded value) —
  // found stale 2026-09-22: this used to hardcode `{activateR:1.5,
  // trailR:1.5}`, which drifted from real production the moment
  // `AUTOPILOT_TRAILING` was measured off on 2026-08-27 (see
  // `paperAutoPilot.ts`'s own dated comment). A 'live-mirror' whose whole
  // purpose is to be the trustworthy baseline every other shadow is judged
  // against must actually track what changes in real production, not a
  // value frozen the day this candidate was written.
  {
    key: 'live-mirror',
    label: 'Mirror of production (40 / 65 / AUTOPILOT_TRAILING / 4h gate / whale-flow)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
  },
  // CONTROL (2026-10-23). Whale-flow went into production on 2026-09-09 on a 29-trade record
  // (PF 2.44, best of ~11 candidates). Since then production runs PF 0.97 (37 trades) and every
  // arm still has the gate, so nothing isolates what it contributes. This is 'live-mirror'
  // MINUS the gate and nothing else; compare it to 'live-mirror' over the same dates.
  {
    key: 'no-whale',
    label: 'Mirror of production WITHOUT the whale-flow gate (isolates what the gate has contributed)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
  },
  // 2026-10-23: costs are 0.6% per round trip against a 2.56% average stop, i.e. 24% of one unit of risk.
  // The cost arithmetic is exact: a stop twice as wide halves the cost per unit of risk (0.6% / 2.56% = 24% of R
  // today). Whether that helps net of everything else is NOT established: random entries run through the same
  // exits averaged -0.39% at today's width and +0.28% at 2x (20 coins, 4h bars, Jul-Oct 2026), but -0.84% and -2.16%
  // in the last 30 days at 1h bars, with block standard errors of 0.3-1.1 points: the sign flips with the period, so
  // the control supports neither width. This candidate widens stop and target 2x (4 / 8 ATR) and changes nothing
  // else; position size shrinks automatically (same % risk). A pre-registered test, not a finding.
  {
    key: 'wide-stop',
    label: 'Mirror of production with stop and target 2x wider (4 / 8 ATR): tests cost drag per unit of risk',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    signalCriteria: { atrStopMultiple: 4, atrTargetMultiple: 8 },
  },
  {
    key: 'no-confirm',
    label: 'No higher-timeframe gate (isolates what the 4h gate contributes)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
  },
  // Was 'fixed-stop' (no trailing) — repurposed 2026-09-22, David's "think
  // big" upgrade request: does the trailing-stop mechanism (built, wired,
  // but measured OFF for real money on 2026-08-27's dataset) actually help
  // on THIS forward-going window? A fresh re-measurement the same day
  // (`scripts/sweepAutopilot.mts`, real Kraken data, 3 windows incl.
  // in-sample/out-of-sample) came back genuinely MIXED — a clear win on a
  // 2-year daily window, roughly neutral on 1h/30d, worse profit factor on
  // 4h/120d — not the clean, unambiguous improvement this project's "only
  // measured improvements" bar requires before touching real capital. Same
  // config everywhere else as `live-mirror` (including whale-flow) so this
  // isolates EXACTLY one variable — trailing on vs off — against the true
  // current production baseline, and the resulting real forward record (not
  // another backtest) decides whether `AUTOPILOT_TRAILING` should ever
  // change from `undefined`.
  {
    key: 'trailing-forward-test',
    label: 'Trailing stop 1.5R/1.5R vs current no-trail production (forward test since 2026-09-22)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 1.5, trailR: 1.5 },
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
  },
  // This candidate, and every other one below that frames itself as
  // isolating a single variable against `live-mirror` (`top-trader`,
  // `ai-judgment`, `correlation-capped`), used to also hardcode the same
  // stale `{activateR:1.5, trailR:1.5}` `live-mirror` itself had — fixed
  // 2026-09-22 alongside that same bug (see `live-mirror`'s own comment):
  // without this, each one was silently comparing "its own feature AND the
  // old trailing setting" against the corrected baseline, not just its own
  // feature. `mean-reversion`/`breakout` below are deliberately exempt —
  // they're a different signal FAMILY with their own independent
  // hyperparameters already (see their own comment), never framed as a
  // single-variable isolation in the first place.
  {
    key: 'high-conviction',
    label: 'Conviction 55 (trades rarely; tests whether selectivity alone helps)',
    minConfidence: 55,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
  },
  // A different FAMILY, not a different setting. Backtested positive with a
  // usable sample where every momentum setting lost — which is exactly the
  // situation where a forward record is worth more than another backtest.
  {
    key: 'mean-reversion',
    label: 'Mean reversion (buys oversold stretch, refuses a falling knife)',
    minConfidence: 0,
    maxRsiForLong: 100,
    trailing: { activateR: 1.5, trailR: 1.5 },
    evaluate: meanReversionSignal,
  },
  {
    key: 'breakout',
    label: 'Breakout from compression (narrow base + volume)',
    minConfidence: 0,
    maxRsiForLong: 100,
    trailing: { activateR: 1.5, trailR: 1.5 },
    evaluate: breakoutSignal,
  },
  // Otherwise identical to live-mirror — isolates what refusing to buy while
  // OKX's own top traders are net-short contributes. Real history DOES
  // exist here (unlike whale-flow), but the available ~100-day window was
  // too sparse (0-1 trades) in the current bearish stretch to trust a
  // backtest verdict from it — a forward record is the honest next step.
  {
    key: 'top-trader',
    label: 'Refuses entries while OKX top traders are net-short',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useTopTraderCheck: true,
  },
  // Otherwise identical to live-mirror — isolates what an LLM's read of the
  // technical snapshot contributes as a second opinion. Cannot be backtested
  // (see aiJudgment.ts); a no-op (always allows) until GEMINI_API_KEY (free
  // tier, preferred) or ANTHROPIC_API_KEY (paid fallback) is configured, so
  // this candidate simply mirrors live-mirror until then.
  {
    key: 'ai-judgment',
    label: 'Refuses entries an AI second opinion reads as bearish',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    // Added 2026-10-04: production has run whale-flow since 2026-09-09, and
    // this candidate was missing it — so its record vs 'live-mirror' mixed
    // "add AI check" with "drop whale-flow". Records before this date are
    // confounded; only trades from 2026-10-04 on isolate the AI check alone.
    useWhaleFlowCheck: true,
    useAiJudgmentCheck: true,
  },
  // Otherwise identical to live-mirror — isolates what capping exposure to a
  // correlated cluster of open positions contributes (see riskEngine.ts's
  // correlationThreshold/maxCorrelatedExposurePct: built and unit-tested, but
  // never turned on in production). First-guess threshold/cap, unmeasured —
  // this candidate exists to measure them, not because they're known good.
  // David's 5-item "think big" upgrade request, item 5 (2026-09-22).
  {
    key: 'correlation-capped',
    label: 'Caps exposure to a correlated cluster (threshold 0.7, cap 30% of equity)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    // Same 2026-10-04 whale-flow parity fix as 'ai-judgment' above.
    useWhaleFlowCheck: true,
    correlationCap: { threshold: 0.7, maxExposurePct: 30 },
  },
  // Identical to live-mirror plus ONE change: refuse new longs while OKX
  // funding shows leveraged longs unusually crowded (signal/fundingGate.ts).
  // David's 2026-10-04 request for leading ("predict the future") signals,
  // not just price history. Gate parameters (24h avg in the top 20% of the
  // coin's own ~33-day history and above its median) were picked by firing
  // rate (~13% of checks), never by profitability — whether blocking those
  // entries helps is what this candidate exists to measure.
  {
    key: 'funding-crowding',
    label: 'Refuses entries while leveraged longs are unusually crowded (OKX funding)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    useFundingCheck: true,
  },
  // 2026-10-19 (David: "justified hope, not a promise"). Two candidates that
  // each change exactly ONE thing against 'live-mirror', so the forward record
  // says what that thing is worth:
  //  - closed-bars: live entries are decided on the still-forming candle while
  //    every backtest uses closed bars; 9 of 17 reconstructable live entries
  //    would not have passed at bar close, but the sample (n=17) could not show
  //    whether that hurts. This measures it forward.
  //  - f2-gated: the F2 rule (7-day Fear&Greed avg > 50 and BTC > SMA100) as a
  //    market-wide entry gate — it cut max drawdown 74% -> 39% over 2018-2026.
  {
    key: 'closed-bars',
    label: 'Mirror of production, entries decided on CLOSED bars only (tests the forming-candle repaint)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    closedBarsOnly: true,
  },
  {
    key: 'f2-gated',
    label: 'Mirror of production, entries only while the F2 sentiment-trend rule says hold',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    useSentimentGate: true,
  },
  // 2026-10-22 (David: winners turn into losses — LTC peaked +9.5% and closed
  // -12%; 16 of 59 paper stop-outs had first been up >=2%). Each differs from
  // 'live-mirror' ONLY in the exit rule, so the record says what protecting an
  // open profit is worth (the earlier 'trailing-forward-test' is a wider trail).
  //  - breakeven-lock: once price runs +0.8R (~+2%), the stop moves to entry.
  //  - trail-tight: trails 1R behind the best price once +1R is reached.
  {
    key: 'breakeven-lock',
    label: 'Mirror of production, stop moves to break-even after a +0.8R run',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 0.8, trailR: 5 },
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
  },
  {
    key: 'trail-tight',
    label: 'Mirror of production, tight trailing stop (activates at +1R, trails 1R)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 1, trailR: 1 },
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
  },
  // 2026-10-27 (David: "no trades all week"). Nothing is broken: the scan runs and
  // every gate is open, but 6 of 20 coins (BTC RSI 72.5, XRP 68.9, DOGE 68.7...) were refused
  // as "overextended" by the RSI-65 ceiling, while the rest had too little bullish evidence.
  // That ceiling was measured on ~30 days of 5 coins (PROJECT_STATE, 2026-08), and the arena
  // audit found settings fitted to tiny windows; the 2018-2026 study found trend-continuation
  // features (high momentum / RSI) raise the odds of further gains. One change vs 'live-mirror':
  // ceiling 75 (the value the ceiling was originally lowered from). Forward-test only.
  {
    key: 'rsi-ceiling-75',
    label: 'Mirror of production, RSI entry ceiling 75 instead of 65 (are hot coins refused for nothing?)',
    minConfidence: 40,
    maxRsiForLong: 75,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
  },
  // 2026-10-20 (David: a separate HIGH-RISK demo, judged in a few months).
  // Identical entry signal to 'live-mirror'; only the size caps change, so the
  // record shows what bigger bets do — more gain AND more loss, no new edge.
  // Judged on the promotion bar with a 35% drawdown ceiling
  // (`HIGH_RISK_MAX_DRAWDOWN_PCT`, pre-registered). Simulated money only.
  {
    key: 'risk-3x',
    label: 'HIGH RISK demo: live-mirror signal, 3% risk/trade, positions up to 40%, up to 4 open',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    riskLimits: {
      maxRiskPerTradePct: 3,
      maxPositionPct: 40,
      maxExposurePerAssetPct: 40,
      maxTotalExposurePct: 100,
      maxOpenPositions: 4,
      dailyLossLimitPct: 9,
    },
  },
  {
    key: 'risk-6x',
    label: 'VERY HIGH RISK demo: live-mirror signal, 6% risk/trade, positions up to 60%, up to 3 open',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: '4h',
    useWhaleFlowCheck: true,
    riskLimits: {
      maxRiskPerTradePct: 6,
      maxPositionPct: 60,
      maxExposurePerAssetPct: 60,
      maxTotalExposurePct: 100,
      maxOpenPositions: 3,
      dailyLossLimitPct: 15,
    },
  },
];
