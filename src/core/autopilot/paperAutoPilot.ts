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
import { MONITOR_INTERVALS, type MonitorInterval, type Scheduler } from '../monitor/scheduler';
import type { PortfolioEngine } from '../position/portfolioEngine';
import type { PositionEngine } from '../position/positionEngine';
import type { ExitReason } from '../position/tradeJournal';
import { assessTrade, DEFAULT_RISK_LIMITS, type RiskLimits } from '../risk/riskEngine';
import { trailingStopPrice, type TrailingConfig } from '../risk/trailingStop';
import { scanCandles, scanMarket, type ScanResult } from '../scan/marketScanner';
import { applyHigherTimeframeGate } from '../signal/multiTimeframe';
import { DEFAULT_SIGNAL_CRITERIA, evaluateScan } from '../signal/signalEngine';
import type { Timeframe } from '../types';
import type { PersistedAuditLog } from './auditLog';
import type { PersistedKillSwitch } from './killSwitch';

const SCAN_CANDLES = 150;

/**
 * Conviction floor for autonomous entries (0..MAX_CONFIDENCE). A setup can
 * clear the hard gates yet still be a near-coin-flip once its warnings/weak
 * trend are priced in; below this the autopilot refuses to commit capital.
 * Calibrated to keep decent setups (~20%+) while cutting the weak ones
 * (~4–12%) that were producing churn and losses. Capital protection first.
 */
export const AUTOPILOT_MIN_CONFIDENCE = 20;

/**
 * Overbought ceiling for autonomous entries. Measured on ~30 days of real
 * Kraken history (BTC/ETH/SOL/XRP/ADA): lowering the RSI-for-long ceiling from
 * 75 to 65 lifted profit factor ~1.0→2.3 and win rate 45%→65% with lower
 * drawdown — the biggest single quality win. Don't chase already-hot coins.
 */
export const AUTOPILOT_MAX_RSI_FOR_LONG = 65;

/**
 * Production trailing stop. Measured on ~30 days of real Kraken data: adding
 * this to the RSI-ceiling strategy raised aggregate profit factor ~2.4→3.0 and
 * cut max drawdown (~1.1%→0.8%) for similar return — better profitability AND
 * capital protection. Activates after +1×risk, then trails 2×risk below peak.
 */
export const AUTOPILOT_TRAILING: TrailingConfig = { activateR: 1, trailR: 2 };

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
   * Trailing stop for open positions. When set, the stop ratchets up as the
   * trade runs in profit (measured to raise profit factor and cut drawdown).
   * Omit for a fixed stop.
   */
  readonly trailing?: TrailingConfig;
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
      this.options.positions.updateMarketPrice(position.symbol, price, timestamp);

      // Trailing stop: ratchet the stop up as the trade runs in profit. Uses
      // the best price seen so the stop only rises. position.stopLoss stays the
      // ORIGINAL stop (never mutated), so this is a pure, stateless derivation.
      const stopLoss = this.options.trailing
        ? trailingStopPrice({
            entryPrice: position.entryPrice,
            initialStop: position.stopLoss,
            highestPrice: Math.max(position.highestPrice, price),
            config: this.options.trailing,
          })
        : position.stopLoss;

      let reason: ExitReason | null = null;
      if (price <= stopLoss) reason = 'stop-loss';
      else if (price >= position.takeProfit) reason = 'take-profit';
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
      let decision = evaluateScan(scanResult, {
        ...DEFAULT_SIGNAL_CRITERIA,
        maxRsiForLong: this.options.maxRsiForLong ?? DEFAULT_SIGNAL_CRITERIA.maxRsiForLong,
        minConfidence: this.options.minConfidence ?? 0,
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

      const snapshot = this.options.portfolio.snapshot({}, timestamp);
      const correlateWith = this.options.correlationBetween;
      const assessment = assessTrade(
        decision.opportunity,
        {
          equity: snapshot.equity,
          openPositions: this.options.positions
            .openPositions()
            .map((p) => ({ symbol: p.symbol, quantity: p.quantity, entryPrice: p.entryPrice })),
        },
        {
          limits: this.options.riskLimits ?? DEFAULT_RISK_LIMITS,
          dailyLossSoFar: this.options.getDailyLoss(),
          correlationTo: correlateWith
            ? (other: string) => correlateWith(scanResult.symbol, other)
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
