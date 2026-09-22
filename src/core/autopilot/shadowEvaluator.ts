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
import { DEFAULT_RISK_LIMITS } from '../risk/riskEngine';
import type { TrailingConfig } from '../risk/trailingStop';
import type { ScanResult } from '../scan/marketScanner';
import type { SignalDecision } from '../signal/signalEngine';
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
   * Opts into `ShadowRunOptions.aiJudgmentCheck` for this candidate only.
   * An LLM's read of the technical snapshot can NEVER be backtested (it may
   * carry hindsight of what a real historical chart actually did next), so
   * this is forward-only by construction — see `signal/aiJudgment.ts`.
   */
  readonly useAiJudgmentCheck?: boolean;
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
    ...(candidate.useAiJudgmentCheck && options.aiJudgmentCheck
      ? { aiJudgmentCheck: options.aiJudgmentCheck }
      : {}),
    ...(candidate.correlationCap && options.correlationBetween
      ? { correlationBetween: options.correlationBetween }
      : {}),
    riskLimits: candidate.correlationCap
      ? {
          ...DEFAULT_RISK_LIMITS,
          correlationThreshold: candidate.correlationCap.threshold,
          maxCorrelatedExposurePct: candidate.correlationCap.maxExposurePct,
        }
      : DEFAULT_RISK_LIMITS,
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
  {
    key: 'high-conviction',
    label: 'Conviction 55 (trades rarely; tests whether selectivity alone helps)',
    minConfidence: 55,
    maxRsiForLong: 65,
    trailing: { activateR: 1.5, trailR: 1.5 },
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
    trailing: { activateR: 1.5, trailR: 1.5 },
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
    trailing: { activateR: 1.5, trailR: 1.5 },
    confirmationTimeframe: '4h',
    useAiJudgmentCheck: true,
  },
  // Otherwise identical to live-mirror — isolates what capping exposure to a
  // correlated cluster of open positions contributes (see riskEngine.ts's
  // correlationThreshold/maxCorrelatedExposurePct: built and unit-tested, but
  // never turned on in production). First-guess threshold/cap, unmeasured —
  // this candidate exists to measure them, not because they're known good.
  {
    key: 'correlation-capped',
    label: 'Caps exposure to a correlated cluster (threshold 0.7, cap 30% of equity)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 1.5, trailR: 1.5 },
    confirmationTimeframe: '4h',
    correlationCap: { threshold: 0.7, maxExposurePct: 30 },
  },
];
