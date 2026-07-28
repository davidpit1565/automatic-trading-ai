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
import { PaperAutoPilot } from './paperAutoPilot';

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
    baseCurrency: 'EUR',
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
    riskLimits: DEFAULT_RISK_LIMITS,
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
  {
    key: 'live-mirror',
    label: 'Mirror of production (40 / 65 / trail 1.5-1.5 / 4h gate)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 1.5, trailR: 1.5 },
    confirmationTimeframe: '4h',
  },
  {
    key: 'no-confirm',
    label: 'No higher-timeframe gate (isolates what the 4h gate contributes)',
    minConfidence: 40,
    maxRsiForLong: 65,
    trailing: { activateR: 1.5, trailR: 1.5 },
  },
  {
    key: 'fixed-stop',
    label: 'Fixed stop, no trailing (isolates what trailing contributes)',
    minConfidence: 40,
    maxRsiForLong: 65,
    confirmationTimeframe: '4h',
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
];
