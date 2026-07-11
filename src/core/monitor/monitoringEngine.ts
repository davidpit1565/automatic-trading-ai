/**
 * Monitoring Engine — Stage 4.
 *
 * Turns on-demand analysis into continuous watching. Each scheduled scan
 * runs the verified pipeline — Market Scanner → Signal Engine → Risk
 * Engine (+ validation verdict) — over the configured symbols and
 * classifies every market:
 *
 *   none       no actionable evidence
 *   watch      interesting but not tradeable (hot scan without a
 *              qualifying signal, or a signal the Risk Engine refused)
 *   qualified  signal approved by the Risk Engine for the current portfolio
 *
 * Qualified opportunities are appended to the history log, tracked on the
 * watchlist, and alerted (with cooldown). Analysis only: this engine has
 * no execution capability of any kind.
 */

import type { MarketDataSource } from '../data/revolutClient';
import { scanMarket } from '../scan/marketScanner';
import { evaluateScan } from '../signal/signalEngine';
import { assessTrade, type PortfolioRiskState } from '../risk/riskEngine';
import type { RobustnessVerdict } from '../validation/robustness';
import type { Candle, Timeframe } from '../types';
import { AlertEngine } from './alerts';
import { OpportunityLog, type OpportunityRecord } from './opportunityLog';
import { MONITOR_INTERVALS, type MonitorInterval, type Scheduler } from './scheduler';
import { WatchlistStore, type WatchlistEntry, type WatchStatus } from './watchlist';

const SCAN_CANDLES = 150;

export interface MonitoredOpportunity {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly detectedAt: number;
  readonly price: number;
  readonly confidence: number;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly positionSize: number;
  readonly positionValue: number;
  readonly riskAmount: number;
  readonly riskPct: number;
  readonly explanation: string;
  readonly validationVerdict: RobustnessVerdict | 'not-run';
  readonly warnings: readonly string[];
}

export interface SymbolOutcome {
  readonly symbol: string;
  readonly outcome: WatchStatus;
  /** Present only for qualified outcomes. */
  readonly opportunity?: MonitoredOpportunity;
  /** Why the symbol did not qualify (signal or risk reasons). */
  readonly reasons: readonly string[];
}

export interface MonitorScanResult {
  readonly timestamp: number;
  readonly timeframe: Timeframe;
  readonly outcomes: SymbolOutcome[];
  readonly failures: { readonly symbol: string; readonly reason: string }[];
}

export interface MonitoringStatus {
  readonly running: boolean;
  readonly interval: MonitorInterval | null;
  readonly lastScanAt: number | null;
  readonly nextScanAt: number | null;
  readonly lastResult: MonitorScanResult | null;
}

/** Produces a validation verdict for a symbol's candles (stubbed in tests). */
export type ValidationVerdictProvider = (
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
) => RobustnessVerdict | 'not-run';

export interface MonitoringEngineOptions {
  readonly source: MarketDataSource;
  readonly symbols: readonly string[];
  readonly timeframe: Timeframe;
  readonly scheduler: Scheduler;
  readonly watchlist: WatchlistStore;
  readonly log: OpportunityLog;
  readonly alerts: AlertEngine;
  readonly getPortfolio: () => PortfolioRiskState;
  readonly getDailyLoss: () => number;
  readonly validator: ValidationVerdictProvider;
  /** Injectable clock for scheduled scans; defaults to Date.now. */
  readonly clock?: () => number;
}

export class MonitoringEngine {
  private readonly clock: () => number;
  private interval: MonitorInterval | null = null;
  private lastScanAt: number | null = null;
  private lastResult: MonitorScanResult | null = null;
  /** Symbols qualified in the previous scan, for disappearance tracking. */
  private previouslyQualified = new Set<string>();

  constructor(private readonly options: MonitoringEngineOptions) {
    this.clock = options.clock ?? (() => Date.now());
  }

  start(interval: MonitorInterval): void {
    this.interval = interval;
    this.options.scheduler.start(MONITOR_INTERVALS[interval], async () => {
      await this.runScanOnce(this.clock());
    });
  }

  stop(): void {
    this.options.scheduler.stop();
    this.interval = null;
  }

  status(): MonitoringStatus {
    const running = this.options.scheduler.isRunning();
    const intervalMs = this.options.scheduler.intervalMs();
    return {
      running,
      interval: running ? this.interval : null,
      lastScanAt: this.lastScanAt,
      nextScanAt:
        running && this.lastScanAt !== null && intervalMs !== null
          ? this.lastScanAt + intervalMs
          : null,
      lastResult: this.lastResult,
    };
  }

  watchlistEntries(): WatchlistEntry[] {
    return this.options.watchlist.entries();
  }

  opportunityHistory(): readonly OpportunityRecord[] {
    return this.options.log.entries();
  }

  alertHistory() {
    return this.options.alerts.history();
  }

  /** One full monitoring pass. Called by the scheduler; callable manually. */
  async runScanOnce(timestamp: number): Promise<MonitorScanResult> {
    const { source, symbols, timeframe } = this.options;
    const scan = await scanMarket(source, symbols, timeframe, SCAN_CANDLES);
    const portfolio = this.options.getPortfolio();
    const dailyLossSoFar = this.options.getDailyLoss();

    const outcomes: SymbolOutcome[] = [];
    const nowQualified = new Set<string>();

    for (const scanResult of scan.results) {
      const decision = evaluateScan(scanResult);

      if (decision.kind === 'rejected') {
        // Hot markets that fail signal gates stay on the radar as 'watch'.
        const outcome: WatchStatus = scanResult.temperature === 'hot' ? 'watch' : 'none';
        outcomes.push({ symbol: scanResult.symbol, outcome, reasons: decision.reasons });
        this.options.watchlist.recordScanOutcome(scanResult.symbol, {
          timestamp,
          status: outcome,
        });
        continue;
      }

      const assessment = assessTrade(decision.opportunity, portfolio, { dailyLossSoFar });
      if (!assessment.approved) {
        outcomes.push({
          symbol: scanResult.symbol,
          outcome: 'watch',
          reasons: assessment.reasons,
        });
        this.options.watchlist.recordScanOutcome(scanResult.symbol, {
          timestamp,
          status: 'watch',
          confidence: decision.opportunity.confidence,
        });
        continue;
      }

      // Qualified: validation verdict, history, watchlist, alert.
      const candles = await source.getCandles(scanResult.symbol, timeframe, SCAN_CANDLES);
      const verdict = candles.ok
        ? this.options.validator(scanResult.symbol, timeframe, candles.value)
        : 'not-run';

      const opportunity: MonitoredOpportunity = {
        symbol: scanResult.symbol,
        timeframe,
        detectedAt: timestamp,
        price: scanResult.snapshot.price,
        confidence: decision.opportunity.confidence,
        entry: assessment.entry,
        stopLoss: assessment.stopLoss,
        takeProfit: assessment.takeProfit,
        positionSize: assessment.positionSize,
        positionValue: assessment.positionValue,
        riskAmount: assessment.riskAmount,
        riskPct: assessment.riskPercentage,
        explanation: decision.opportunity.explanation,
        validationVerdict: verdict,
        warnings: [...decision.opportunity.warnings, ...assessment.warnings],
      };

      nowQualified.add(scanResult.symbol);
      outcomes.push({
        symbol: scanResult.symbol,
        outcome: 'qualified',
        opportunity,
        reasons: assessment.reasons,
      });

      this.options.log.append({
        id: `${opportunity.symbol}:${timeframe}:${timestamp}`,
        detectedAt: timestamp,
        symbol: opportunity.symbol,
        timeframe,
        price: opportunity.price,
        confidence: opportunity.confidence,
        entry: opportunity.entry,
        stopLoss: opportunity.stopLoss,
        takeProfit: opportunity.takeProfit,
        positionSize: opportunity.positionSize,
        riskPct: opportunity.riskPct,
        explanation: opportunity.explanation,
        validationVerdict: verdict,
        snapshot: {
          rsi: scanResult.snapshot.rsi,
          adx: scanResult.snapshot.adx,
          atrPct: scanResult.snapshot.atrPct,
          relativeVolume: scanResult.snapshot.relativeVolume,
        },
        disappearedAt: null,
      });
      this.options.watchlist.recordScanOutcome(scanResult.symbol, {
        timestamp,
        status: 'qualified',
        confidence: opportunity.confidence,
      });
      await this.options.alerts.notify(
        {
          symbol: opportunity.symbol,
          timeframe,
          confidence: opportunity.confidence,
          price: opportunity.price,
          explanation: opportunity.explanation,
        },
        timestamp,
      );
    }

    // Signals that qualified last scan but not this one have disappeared.
    for (const symbol of this.previouslyQualified) {
      if (!nowQualified.has(symbol)) {
        this.options.log.markDisappeared(symbol, timeframe, timestamp);
      }
    }
    this.previouslyQualified = nowQualified;

    const result: MonitorScanResult = {
      timestamp,
      timeframe,
      outcomes,
      failures: scan.failures,
    };
    this.lastScanAt = timestamp;
    this.lastResult = result;
    return result;
  }
}
