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
import { assessTrade } from '../risk/riskEngine';
import { scanMarket } from '../scan/marketScanner';
import { evaluateScan } from '../signal/signalEngine';
import type { Timeframe } from '../types';
import type { PersistedAuditLog } from './auditLog';
import type { PersistedKillSwitch } from './killSwitch';

const SCAN_CANDLES = 150;

export interface AutoPilotOptions {
  readonly source: MarketDataSource;
  readonly symbols: readonly string[];
  readonly timeframe: Timeframe;
  readonly scheduler: Scheduler;
  readonly portfolio: PortfolioEngine;
  readonly positions: PositionEngine;
  readonly killSwitch: PersistedKillSwitch;
  readonly audit: PersistedAuditLog;
  readonly getDailyLoss: () => number;
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
  readonly opened: { symbol: string; quantity: number; entry: number }[];
  readonly closed: { symbol: string; reason: ExitReason; price: number }[];
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

      let reason: ExitReason | null = null;
      if (price <= position.stopLoss) reason = 'stop-loss';
      else if (price >= position.takeProfit) reason = 'take-profit';
      if (reason === null) continue;

      const exit = this.options.portfolio.exit(position.id, {
        quantity: position.quantity,
        price,
        timestamp,
        reason,
      });
      if (exit.ok) {
        closed.push({ symbol: position.symbol, reason, price });
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
      const decision = evaluateScan(scanResult);
      if (decision.kind === 'rejected') continue; // no signal — nothing to audit

      const snapshot = this.options.portfolio.snapshot({}, timestamp);
      const assessment = assessTrade(
        decision.opportunity,
        {
          equity: snapshot.equity,
          openPositions: this.options.positions
            .openPositions()
            .map((p) => ({ symbol: p.symbol, quantity: p.quantity, entryPrice: p.entryPrice })),
        },
        { dailyLossSoFar: this.options.getDailyLoss() },
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
        confidence: decision.opportunity.confidence,
        strategyVersion: 'autopilot-paper-v1',
        notes: 'opened autonomously by the paper autopilot',
      });
      if (openedPosition.ok) {
        opened.push({
          symbol: scanResult.symbol,
          quantity: openedPosition.value.quantity,
          entry: openedPosition.value.entryPrice,
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
