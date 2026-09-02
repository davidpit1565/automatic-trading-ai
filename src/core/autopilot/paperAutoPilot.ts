/**
 * Paper Autopilot — autonomous SIMULATED trading.
 *
 * Runs the verified pipeline (scanner → signal → risk) on a schedule and
 * acts on it with paper money only:
 *   - opens a simulated position when a market qualifies and the Risk
 *     Engine approves it for the current paper portfolio;
 *   - closes simulated positions when price reaches their stop loss or
 *     take profit;
 *   - records every action (and every refusal) in the append-only audit log;
 *   - halts everything instantly while the kill switch is engaged.
 *
 * PAPER-ONLY BY CONSTRUCTION. `mode` is the literal 'paper'; there is no
 * live branch, no broker adapter, and no code path that can place a real
 * order. Live execution remains Stage 6 and requires the blocking human
 * ConfirmationGate defined in the execution architecture — automation
 * never removes that gate, it is only allowed below it (simulation).
 */

import type { MarketDataSource } from '../data/revolutClient';
import type { KeyValueStore } from '../data/storage';
import type { ExecutionMode } from '../execution/types';
import { decideExit } from './exitDecision';
import { MONITOR_INTERVALS, type MonitorInterval, type Scheduler } from '../monitor/scheduler';
import type { PortfolioEngine } from '../position/portfolioEngine';
import type { PositionEngine } from '../position/positionEngine';
import type { ExitReason } from '../position/tradeJournal';
import { assessTrade, confidenceScaledRiskPct, DEFAULT_RISK_LIMITS, type RiskLimits } from '../risk/riskEngine';
import type { TrailingConfig } from '../risk/trailingStop';
import { scanCandles, scanMarket, type ScanResult } from '../scan/marketScanner';
import { applyHigherTimeframeGate } from '../signal/multiTimeframe';
import { DEFAULT_SIGNAL_CRITERIA, evaluateScan, MAX_CONFIDENCE, type SignalDecision } from '../signal/signalEngine';
import type { Timeframe } from '../types';
import type { PersistedAuditLog } from './auditLog';
import type { PersistedKillSwitch } from './killSwitch';

const SCAN_CANDLES = 150;

/**
 * Conviction floor for autonomous entries (0..MAX_CONFIDENCE). A setup can
 * clear the hard gates yet still be a near-coin-flip once its warnings/weak
 * trend are priced in; below this the autopilot refuses to commit capital.
 * Re-measured 2026-07-27 on the actual 10-symbol production universe (not a
 * 5-symbol proxy), real Kraken data, 720 1h candles, with the current
 * trailing stop: raising the floor from 20 to 40 turned a net-losing window
 * (return -0.35%, PF 0.71, max drawdown 1.29%) into a net-positive one
 * (return +0.03%, PF 1.15, max drawdown 0.34% — a 73% cut) and improved
 * out-of-sample PF (0.40→0.45). 45+ starves the sample to single digits
 * of trades — too sparse to trust. Capital protection first.
 */
export const AUTOPILOT_MIN_CONFIDENCE = 40;

/**
 * Overbought ceiling for autonomous entries. Measured on ~30 days of real
 * Kraken history (BTC/ETH/SOL/XRP/ADA): lowering the RSI-for-long ceiling from
 * 75 to 65 lifted profit factor ~1.0→2.3 and win rate 45%→65% with lower
 * drawdown — the biggest single quality win. Don't chase already-hot coins.
 */
export const AUTOPILOT_MAX_RSI_FOR_LONG = 65;

/**
 * Production trailing stop — currently OFF. Re-measured 2026-08-27 on the
 * real, current production config (`scripts/sweepAutopilot.mts`, which
 * replays the actual PaperAutoPilot rather than sweepStrategy.mts's
 * per-symbol approximation — that older script's "PROD baseline" row had
 * drifted stale, still hardcoding minConfidence 20 against the real 40):
 * across both windows tested (1h entries/30d and 4h entries/120d, in-sample
 * + out-of-sample), dropping the {activateR:1.5, trailR:1.5} trail never
 * did worse than keeping it, and in the 1h window it did better (return
 * 13.56%→14.15%, same 92.3% win rate, 13 trades) — the tighter 1.5R
 * activation was cutting some winners short before their fixed target
 * rather than protecting more profit than the target already locks in.
 * Kept as a config knob (`trailing?` below) rather than deleted, since a
 * future measurement on a different window could reverse this.
 */
export const AUTOPILOT_TRAILING: TrailingConfig | undefined = undefined;

/**
 * Daily-EMA period for the regime gate (see `signal/regimeFilter.ts`).
 * Measured 2026-08-10 on real Kraken data (`scripts/sweepAutopilot.mts`, 10
 * majors, both the 30-day and the 120-day/-22%-buy-and-hold windows,
 * in-sample + out-of-sample): every regime-filtered variant tested (EMA
 * 50/100/200) matched or beat plain production on return, never worse —
 * most dramatically in the deep-downtrend window this filter targets.
 * EMA200 was too strict (blocked entries almost entirely, 0-1 trades).
 * EMA50 keeps more trading activity than EMA100 (4-6 vs 1-3 trades per
 * window) while still improving every split tested — the better balance of
 * the two candidates that actually traded enough to judge.
 */
export const AUTOPILOT_REGIME_PERIOD = 50;

/**
 * Confidence-scaled risk range for entries (see `confidenceScaledRiskPct`).
 * Stays entirely within the existing 1% per-trade risk ceiling — it only
 * reallocates risk from weak setups to strong ones, never raises the
 * ceiling itself. Measured 2026-08-12 (`scripts/sweepAutopilot.mts`, 10
 * majors, real Kraken data, layered on the actual current production config
 * — regime EMA50 + everything else — in-sample + out-of-sample, both the
 * 30-day and 120-day windows): never worse than the fixed-1%-per-trade
 * baseline in any split tested, and meaningfully better in the 120-day
 * window that had enough trades to judge (full return -4.24%→-3.84%,
 * out-of-sample -1.81%→-1.44%). The 30-day window was too trade-sparse
 * (3 trades) to move either way.
 */
export const AUTOPILOT_CONFIDENCE_RISK = { floorPct: 0.5, ceilingPct: 1 };

/**
 * Daily-EMA period for the market-wide regime gate, built from BTC's own
 * daily trend and applied to every symbol's entry (see `marketRegimeCheck`).
 * Measured 2026-08-12 (`scripts/sweepAutopilot.mts`, real Kraken data, both
 * the 30-day and 120-day windows, in-sample + out-of-sample) as a mixed
 * result, not a clean win: it protected capital significantly in the
 * deep-downtrend 120-day window (return -5.32%→-3.04%, out-of-sample
 * -2.96%→-0.63%) but cost performance in the calmer 30-day window by
 * blocking otherwise-good trades (0.49%→-0.80%). Enabled anyway per an
 * explicit decision (2026-08-12) to prioritize capital protection during
 * real market-wide downturns over squeezing out every good trade in calm
 * periods — consistent with CLAUDE.md's priority order (capital protection
 * above raw profit).
 */
export const AUTOPILOT_MARKET_REGIME_PERIOD = 50;

/**
 * Risk limits for live entries — DEFAULT_RISK_LIMITS with a raised total-
 * exposure cap (60% → 80%). Measured 2026-08-21 (`scripts/sweepAutopilot.mts`,
 * real Kraken data, layered on the exact production config — regime EMA50 +
 * confidence-scaled risk — in-sample + out-of-sample, both the 30-day and
 * 120-day windows) specifically to see whether it narrows the real-money-
 * readiness benchmark's gap to plain BTC buy-and-hold: in the 30-day strong-
 * BTC-uptrend window it was the best of the knobs tried, but only +0.90pp
 * over the 60% baseline (9.80%→10.70%, still zero losing trades) against an
 * ~8pp gap to BTC — nowhere near closing it. In the 120-day window it was
 * identical to the baseline (the higher cap was never actually binding).
 * Kept anyway: no downside observed in either window, a small and
 * risk-bounded widening (maxPositionPct/maxOpenPositions unchanged, so any
 * single position is still capped the same way) — but it does not and is
 * not claimed to fix the benchmark criterion; that gap is the accepted cost
 * of this risk-managed design during a strong uptrend, not a bug.
 */
export const AUTOPILOT_RISK_LIMITS: RiskLimits = { ...DEFAULT_RISK_LIMITS, maxTotalExposurePct: 80 };

export interface AutoPilotOptions {
  readonly source: MarketDataSource;
  readonly symbols: readonly string[];
  readonly timeframe: Timeframe;
  /** When set, entries must not fight this larger timeframe's trend. */
  readonly confirmationTimeframe?: Timeframe;
  readonly scheduler: Scheduler;
  readonly portfolio: PortfolioEngine;
  readonly positions: PositionEngine;
  readonly killSwitch: PersistedKillSwitch;
  readonly audit: PersistedAuditLog;
  readonly getDailyLoss: () => number;
  /**
   * Per-side trading cost as a fraction of notional (fee + typical
   * slippage), charged on both entry and exit. Makes the simulation match
   * a real exchange so paper results predict live results. Default 0.
   */
  readonly costRate?: number;
  /**
   * Minimum signal confidence required to open (0..MAX_CONFIDENCE). Defaults
   * to 0 (open any qualifying signal). Production sets AUTOPILOT_MIN_CONFIDENCE.
   */
  readonly minConfidence?: number;
  /**
   * Overbought RSI ceiling for entries. Defaults to the signal engine's
   * permissive value; production sets AUTOPILOT_MAX_RSI_FOR_LONG.
   */
  readonly maxRsiForLong?: number;
  /**
   * Replaces the entry signal entirely. Defaults to `evaluateScan`, the
   * production trend/momentum signal.
   *
   * This exists because sweeping parameters proved the *current* signal has a
   * negative per-trade edge — no setting of it wins. Testing a genuinely
   * different idea therefore has to be possible without touching this class,
   * and without any candidate being able to reach production by accident.
   * Everything downstream — risk sizing, portfolio caps, exits, the audit log —
   * is unchanged, so two signals are compared on equal terms.
   */
  readonly evaluate?: (scan: ScanResult, floor: number) => SignalDecision;
  /**
   * Trailing stop for open positions. When set, the stop ratchets up as the
   * trade runs in profit (measured to raise profit factor and cut drawdown).
   * Omit for a fixed stop.
   */
  readonly trailing?: TrailingConfig;
  /**
   * Hold-through-trend exit: replaces the FIXED take-profit with "close below
   * a trailing EMA" — same idea already measured in the backtest harness
   * (`livePipeline.ts`'s `trendExit`), now wired into the real engine so it
   * can be measured against the actual PaperAutoPilot rather than only its
   * backtest approximation. The protective stop-loss is unchanged and still
   * checked FIRST every cycle: a bar that guts the stop is still a stop-loss
   * regardless of trendExit being configured — capital protection is never
   * overridden by letting a winner run. Omit for the existing fixed-target
   * behaviour; only one of `trendExit`/fixed-target applies per position
   * (mirrors `livePipeline.ts`'s own `else if`).
   */
  readonly trendExit?: { readonly emaPeriod: number };
  /**
   * When it returns true, the cycle SKIPS new entries (exits/stops still run).
   * Used by the portfolio drawdown circuit-breaker: stop adding risk while the
   * portfolio is well below its peak. Unlike the kill switch, this never
   * blocks protective exits.
   */
  readonly haltNewEntries?: () => boolean;
  /** Risk limits for the risk engine. Default DEFAULT_RISK_LIMITS. */
  readonly riskLimits?: RiskLimits;
  /**
   * Return-correlation (-1..1) between two symbols, e.g. from recent price
   * history. Paired with `riskLimits.correlationThreshold` /
   * `maxCorrelatedExposurePct` to cap combined exposure across a correlated
   * cluster (several co-moving alts stopping out together) — see
   * `assessTrade`. Omit to leave that check off (the per-asset cap still
   * applies as always).
   */
  readonly correlationBetween?: (a: string, b: string) => number;
  /**
   * Called with each position's realized P&L (positive or negative) as it
   * closes, so callers can feed a `DailyLossTracker` (or similar). Optional —
   * omit if nothing needs to observe realized results.
   */
  readonly onRealizedPnl?: (pnl: number, timestamp: number) => void;
  /**
   * Daily trend regime gate (see `signal/regimeFilter.ts`'s
   * `buildDailyRegimeFilter`): returns false to block a new long entry when
   * the larger daily trend is down, regardless of the entry-timeframe setup.
   * Checked at entry time only — never blocks an exit. Omit to leave this
   * check off (the pre-existing behaviour).
   */
  readonly regimeCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Market-wide daily trend regime gate, e.g. built from BTC's own daily
   * trend (see `signal/regimeFilter.ts`'s `buildDailyRegimeFilter`): returns
   * false to block a new long entry in ANY symbol — including BTC itself —
   * while the broader market's daily trend is down, regardless of that
   * symbol's own trend or setup. Distinct from `regimeCheck` (per-symbol
   * trend): a coin can look fine on its own chart while the market it trades
   * inside is rolling over. Checked alongside `regimeCheck`, not instead of
   * it. Checked at entry time only — never blocks an exit. Omit to leave
   * this check off (the pre-existing behaviour).
   */
  readonly marketRegimeCheck?: (timestamp: number) => Promise<boolean>;
  /**
   * Large-trade ("whale") flow gate (see `signal/whaleFlow.ts`): returns
   * false to block a new long entry when the largest recent trades in that
   * symbol show heavy net selling. UNLIKE the regime gates above, this has
   * no historical validation — Kraken's public API exposes no historical
   * order-book/trade-tape depth to backtest against — so it belongs in a
   * shadow candidate (see `shadowEvaluator.ts`) accumulating a genuine
   * forward record, not in production, until proven. Checked at entry time
   * only — never blocks an exit. Omit to leave this check off.
   */
  readonly whaleFlowCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Top-trader positioning gate (see `signal/topTraderGate.ts` /
   * `data/okxPositioning.ts`): returns false to block a new long entry when
   * OKX's own top traders (aggregate, anonymous) are net-short that asset.
   * UNLIKE `whaleFlowCheck`, this one DOES have real historical data (~100
   * daily points, verified 2026-08-17) and can be measured against real
   * history like the regime gates — see `AUTOPILOT_TOP_TRADER_BEARISH_RATIO`
   * for the measured rationale before this was enabled in production.
   * Checked at entry time only — never blocks an exit. Omit to leave this
   * check off.
   */
  readonly topTraderCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * AI second-opinion gate (see `signal/aiJudgment.ts`): returns false to
   * block a new long entry when an LLM's read of the technical snapshot is
   * bearish enough to avoid. UNLIKE every other gate above, this can NEVER
   * be backtested — a model may carry latent knowledge of what a real
   * historical chart actually did next, which would contaminate any replay
   * with hindsight the strategy could never have had live. Exists ONLY to
   * accumulate a forward record via shadow evaluation; never wire this into
   * production. Checked at entry time only — never blocks an exit. Omit to
   * leave this check off.
   */
  readonly aiJudgmentCheck?: (symbol: string, timestamp: number) => Promise<boolean>;
  /**
   * Ties position size to signal conviction instead of every qualifying trade
   * risking the same fixed %: the weakest setup that still clears
   * `minConfidence` gets `floorPct`, a max-confidence setup gets `ceilingPct`,
   * everything between is interpolated (see `confidenceScaledRiskPct`). Omit
   * to leave the pre-existing behaviour (every trade risks
   * `riskLimits.maxRiskPerTradePct`).
   */
  readonly confidenceRisk?: { readonly floorPct: number; readonly ceilingPct: number };
  readonly clock?: () => number;
  /** Persists the desired running state so the autopilot survives reloads. */
  readonly store?: KeyValueStore;
}

interface PersistedAutopilotState {
  desiredRunning: boolean;
  interval: MonitorInterval | null;
}

const STATE_KEY = 'autopilot-state';

export interface CycleResult {
  readonly timestamp: number;
  readonly halted: boolean;
  readonly opened: {
    /** Stable position id — lets consumers de-duplicate repeated alerts. */
    id?: string;
    symbol: string;
    quantity: number;
    entry: number;
    /** Signal confidence (0..MAX_CONFIDENCE) that drove the entry. */
    confidence?: number;
    /** Short labels of the strongest reasons the entry was taken. */
    reasons?: string[];
  }[];
  readonly closed: { id?: string; symbol: string; reason: ExitReason; price: number; pnl: number }[];
  readonly skipped: { symbol: string; reason: string }[];
}

export interface AutoPilotStatus {
  readonly running: boolean;
  readonly interval: MonitorInterval | null;
  readonly lastCycleAt: number | null;
  readonly nextCycleAt: number | null;
  readonly killSwitchEngaged: boolean;
  readonly lastCycle: CycleResult | null;
}

export class PaperAutoPilot {
  /** Simulation only — the paper literal is the sole mode in this module. */
  readonly mode: ExecutionMode = 'paper';

  private readonly clock: () => number;
  private interval: MonitorInterval | null = null;
  private lastCycleAt: number | null = null;
  private lastCycle: CycleResult | null = null;

  constructor(private readonly options: AutoPilotOptions) {
    this.clock = options.clock ?? (() => Date.now());
  }

  start(interval: MonitorInterval): void {
    this.interval = interval;
    this.options.scheduler.start(MONITOR_INTERVALS[interval], async () => {
      await this.runCycleOnce(this.clock());
    });
    this.persistState({ desiredRunning: true, interval });
  }

  stop(): void {
    this.options.scheduler.stop();
    this.interval = null;
    this.persistState({ desiredRunning: false, interval: null });
  }

  /**
   * Resume after a reload if the autopilot was running when the app closed.
   * Never resumes past an engaged kill switch: restarting after an
   * emergency stop is always an explicit human decision.
   * Returns true when scheduling was restored.
   */
  resume(): boolean {
    const saved = this.options.store?.get<PersistedAutopilotState>(STATE_KEY);
    if (!saved?.desiredRunning || saved.interval === null) return false;
    if (this.options.killSwitch.isEngaged()) return false;
    this.start(saved.interval);
    return true;
  }

  private persistState(state: PersistedAutopilotState): void {
    this.options.store?.set(STATE_KEY, state);
  }

  status(): AutoPilotStatus {
    const running = this.options.scheduler.isRunning();
    const intervalMs = this.options.scheduler.intervalMs();
    return {
      running,
      interval: running ? this.interval : null,
      lastCycleAt: this.lastCycleAt,
      nextCycleAt:
        running && this.lastCycleAt !== null && intervalMs !== null
          ? this.lastCycleAt + intervalMs
          : null,
      killSwitchEngaged: this.options.killSwitch.isEngaged(),
      lastCycle: this.lastCycle,
    };
  }

  /** Scan the confirmation timeframe for one symbol; null when unavailable. */
  private async higherTimeframeScan(symbol: string): Promise<ScanResult | null> {
    const timeframe = this.options.confirmationTimeframe;
    if (!timeframe) return null;
    const candles = await this.options.source.getCandles(symbol, timeframe, SCAN_CANDLES);
    if (!candles.ok) return null;
    const scan = scanCandles(symbol, timeframe, candles.value);
    return scan.ok ? scan.value : null;
  }

  /** One full autonomous cycle: exits first, then qualified entries. */
  async runCycleOnce(timestamp: number): Promise<CycleResult> {
    const { killSwitch, audit } = this.options;
    if (killSwitch.isEngaged()) {
      audit.append({
        timestamp,
        intentId: 'cycle',
        event: 'kill-switch-engaged',
        mode: this.mode,
        detail: `cycle skipped: kill switch engaged (${killSwitch.reason() ?? 'no reason recorded'})`,
      });
      const result: CycleResult = { timestamp, halted: true, opened: [], closed: [], skipped: [] };
      this.lastCycleAt = timestamp;
      this.lastCycle = result;
      return result;
    }

    const opened: CycleResult['opened'] = [];
    const closed: CycleResult['closed'] = [];
    const skipped: CycleResult['skipped'] = [];
    const costRate = this.options.costRate ?? 0;
    /**
     * Latest close per held symbol, collected while checking exits below and
     * fed to `portfolio.snapshot` so the equity the Risk Engine sizes against
     * is marked to market. Valuing open positions at their entry price instead
     * would overstate equity precisely while trades are underwater.
     */
    const marketPrices: Record<string, number> = {};

    // --- Exits first: protect what is already open. ------------------------
    for (const position of this.options.positions.openPositions()) {
      const candles = await this.options.source.getCandles(
        position.symbol,
        this.options.timeframe,
        SCAN_CANDLES,
      );
      if (!candles.ok || candles.value.length === 0) {
        skipped.push({ symbol: position.symbol, reason: `no price data: ${candles.ok ? 'empty' : candles.error}` });
        continue;
      }
      const price = candles.value[candles.value.length - 1]!.close;
      marketPrices[position.symbol] = price;
      this.options.positions.updateMarketPrice(position.symbol, price, timestamp);

      // Exit decision is shared with the live path (decideExit,
      // exitDecision.ts) — same call given the same inputs, per this
      // project's "paper and live are the same pipeline" rule.
      const reason: ExitReason | null = decideExit(
        {
          entryPrice: position.entryPrice,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          highestPrice: position.highestPrice,
        },
        price,
        candles.value.map((c) => c.close),
        { trailing: this.options.trailing, trendExit: this.options.trendExit },
      );
      if (reason === null) continue;

      const exitFee = position.quantity * price * costRate;
      const exit = this.options.portfolio.exit(position.id, {
        quantity: position.quantity,
        price,
        timestamp,
        reason,
        fee: exitFee,
      });
      if (exit.ok) {
        // Mirrors PortfolioEngine.exit's own realized-P&L math (a full close,
        // which is the only kind the autopilot ever does).
        const pnl = position.realizedPnl + (price - position.entryPrice) * position.quantity - exitFee;
        closed.push({ id: position.id, symbol: position.symbol, reason, price, pnl });
        this.options.onRealizedPnl?.(pnl, timestamp);
        audit.append({
          timestamp,
          intentId: position.id,
          event: 'filled',
          mode: this.mode,
          detail: `paper exit ${position.symbol}: ${position.quantity} @ ${price} (${reason})`,
        });
      } else {
        audit.append({
          timestamp,
          intentId: position.id,
          event: 'rejected',
          mode: this.mode,
          detail: `paper exit failed for ${position.symbol}: ${exit.error}`,
        });
      }
    }

    // --- Circuit-breaker: while breached, protect what's open but add no new
    // risk. Exits above already ran; entries are skipped entirely. ------------
    if (this.options.haltNewEntries?.()) {
      audit.append({
        timestamp,
        intentId: 'cycle',
        event: 'rejected',
        mode: this.mode,
        detail: 'new entries paused: portfolio drawdown circuit-breaker engaged',
      });
      const result: CycleResult = { timestamp, halted: false, opened, closed, skipped };
      this.lastCycleAt = timestamp;
      this.lastCycle = result;
      return result;
    }

    // --- Entries: scan the universe and act on qualified opportunities. ----
    const scan = await scanMarket(
      this.options.source,
      this.options.symbols,
      this.options.timeframe,
      SCAN_CANDLES,
    );
    for (const failure of scan.failures) {
      skipped.push({ symbol: failure.symbol, reason: failure.reason });
    }

    const held = new Set(this.options.positions.openPositions().map((p) => p.symbol));
    for (const scanResult of scan.results) {
      if (held.has(scanResult.symbol)) {
        skipped.push({ symbol: scanResult.symbol, reason: 'already holding a position' });
        continue;
      }
      // ORDER IS DELIBERATE AND MEASURED: the confidence floor is applied HERE,
      // before the higher-timeframe bonus below, so that bonus can never lift a
      // setup over the floor — it only ever changes the reported confidence.
      // That looks like a bug and is not. Measured 2026-07-27 on real Kraken
      // data (10 majors, 720 1h candles): moving the floor AFTER the bonus
      // admitted 6→20 trades and made everything worse — return -1.63%→-3.93%,
      // max drawdown 1.67%→4.44% (2.7x), win rate 16.7%→15.0%. The extra trades
      // the bonus would rescue are net-losing. Do not "fix" this ordering.
      const floor = this.options.minConfidence ?? 0;
      let decision = this.options.evaluate
        ? this.options.evaluate(scanResult, floor)
        : evaluateScan(scanResult, {
            ...DEFAULT_SIGNAL_CRITERIA,
            maxRsiForLong: this.options.maxRsiForLong ?? DEFAULT_SIGNAL_CRITERIA.maxRsiForLong,
            minConfidence: floor,
          });
      if (decision.kind === 'rejected') continue; // no signal / below floor — nothing to audit

      // Multi-timeframe confirmation: never open against the larger trend.
      if (this.options.confirmationTimeframe) {
        decision = applyHigherTimeframeGate(
          decision,
          await this.higherTimeframeScan(scanResult.symbol),
        );
        if (decision.kind === 'rejected') {
          skipped.push({ symbol: scanResult.symbol, reason: decision.reasons.join('; ') });
          audit.append({
            timestamp,
            intentId: `${scanResult.symbol}:${timestamp}`,
            event: 'rejected',
            mode: this.mode,
            detail: `higher-timeframe gate refused ${scanResult.symbol}: ${decision.reasons.join('; ')}`,
          });
          continue;
        }
      }

      // Daily regime gate: never open a long while the larger daily trend is
      // down, even if the entry-timeframe setup and higher-timeframe gate
      // above both passed — this targets a distinct failure mode (choppy
      // entries inside a downtrend), not entry quality. See regimeFilter.ts.
      if (this.options.regimeCheck && !(await this.options.regimeCheck(scanResult.symbol, timestamp))) {
        skipped.push({ symbol: scanResult.symbol, reason: 'daily regime filter: larger trend is down' });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `daily regime filter refused ${scanResult.symbol}: larger trend is down`,
        });
        continue;
      }

      // Market-wide regime gate: a coin's own chart can look fine while the
      // broader market it trades inside is rolling over. Same fail-open
      // contract as regimeCheck, applied to every symbol including BTC.
      if (this.options.marketRegimeCheck && !(await this.options.marketRegimeCheck(timestamp))) {
        skipped.push({ symbol: scanResult.symbol, reason: 'market regime filter: broader market trend is down' });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `market regime filter refused ${scanResult.symbol}: broader market trend is down`,
        });
        continue;
      }

      // Whale-flow gate: forward-test-only, see the option's doc comment.
      if (this.options.whaleFlowCheck && !(await this.options.whaleFlowCheck(scanResult.symbol, timestamp))) {
        skipped.push({ symbol: scanResult.symbol, reason: 'whale flow filter: large trades show heavy net selling' });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `whale flow filter refused ${scanResult.symbol}: large trades show heavy net selling`,
        });
        continue;
      }

      // Top-trader positioning gate: see the option's doc comment.
      if (this.options.topTraderCheck && !(await this.options.topTraderCheck(scanResult.symbol, timestamp))) {
        skipped.push({ symbol: scanResult.symbol, reason: 'top-trader positioning: OKX top traders are net-short' });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `top-trader positioning refused ${scanResult.symbol}: OKX top traders are net-short`,
        });
        continue;
      }

      // AI second-opinion gate: forward-test-only, see the option's doc comment.
      if (this.options.aiJudgmentCheck && !(await this.options.aiJudgmentCheck(scanResult.symbol, timestamp))) {
        skipped.push({ symbol: scanResult.symbol, reason: 'AI second opinion: bearish read of the setup' });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `AI second opinion refused ${scanResult.symbol}: bearish read of the setup`,
        });
        continue;
      }

      const snapshot = this.options.portfolio.snapshot(marketPrices, timestamp);
      const correlateWith = this.options.correlationBetween;
      const confidenceRisk = this.options.confidenceRisk;
      const assessment = assessTrade(
        decision.opportunity,
        {
          equity: snapshot.equity,
          openPositions: this.options.positions
            .openPositions()
            .map((p) => ({
              symbol: p.symbol,
              quantity: p.quantity,
              entryPrice: p.entryPrice,
              currentPrice: marketPrices[p.symbol] ?? p.entryPrice,
            })),
        },
        {
          limits: this.options.riskLimits ?? DEFAULT_RISK_LIMITS,
          dailyLossSoFar: this.options.getDailyLoss(),
          correlationTo: correlateWith
            ? (other: string) => correlateWith(scanResult.symbol, other)
            : undefined,
          riskPerTradePct: confidenceRisk
            ? confidenceScaledRiskPct(
                decision.opportunity.confidence,
                floor,
                MAX_CONFIDENCE,
                confidenceRisk.floorPct,
                confidenceRisk.ceilingPct,
              )
            : undefined,
        },
      );
      if (!assessment.approved) {
        skipped.push({ symbol: scanResult.symbol, reason: assessment.reasons.join('; ') });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `risk engine refused ${scanResult.symbol}: ${assessment.reasons.join('; ')}`,
        });
        continue;
      }

      const openedPosition = this.options.portfolio.openFromAssessment(assessment, {
        timestamp,
        fee: assessment.positionSize * assessment.entry * costRate,
        confidence: decision.opportunity.confidence,
        strategyVersion: 'autopilot-paper-v1',
        notes: 'opened autonomously by the paper autopilot',
      });
      if (openedPosition.ok) {
        const topReasons = decision.opportunity.confidenceComponents
          .filter((c) => c.effect > 0)
          .sort((a, b) => b.effect - a.effect)
          .slice(0, 2)
          .map((c) => c.label);
        opened.push({
          id: openedPosition.value.id,
          symbol: scanResult.symbol,
          quantity: openedPosition.value.quantity,
          entry: openedPosition.value.entryPrice,
          confidence: decision.opportunity.confidence,
          reasons: topReasons,
        });
        held.add(scanResult.symbol);
        audit.append({
          timestamp,
          intentId: openedPosition.value.id,
          event: 'filled',
          mode: this.mode,
          detail:
            `paper entry ${scanResult.symbol}: ${openedPosition.value.quantity} @ ` +
            `${openedPosition.value.entryPrice} (stop ${assessment.stopLoss}, target ${assessment.takeProfit}, ` +
            `confidence ${decision.opportunity.confidence.toFixed(0)})`,
        });
      } else {
        skipped.push({ symbol: scanResult.symbol, reason: openedPosition.error });
        audit.append({
          timestamp,
          intentId: `${scanResult.symbol}:${timestamp}`,
          event: 'rejected',
          mode: this.mode,
          detail: `paper entry failed for ${scanResult.symbol}: ${openedPosition.error}`,
        });
      }
    }

    const result: CycleResult = { timestamp, halted: false, opened, closed, skipped };
    this.lastCycleAt = timestamp;
    this.lastCycle = result;
    return result;
  }
}
