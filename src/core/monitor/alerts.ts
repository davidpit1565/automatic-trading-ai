/**
 * Alert engine — Stage 4.
 *
 * Alerts fire only for qualified opportunities and never spam: a per
 * symbol+timeframe cooldown suppresses repeats, state and history persist
 * across sessions. Channels are pluggable (in-app and browser notification
 * channels exist today; email/Telegram/etc. can be added later without
 * touching this engine).
 */

import type { KeyValueStore } from '../data/storage';
import type { Timeframe } from '../types';

export interface Alert {
  readonly id: string;
  readonly createdAt: number;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly confidence: number;
  readonly title: string;
  readonly message: string;
}

export interface AlertChannel {
  readonly name: string;
  deliver(alert: Alert): void | Promise<void>;
}

export interface AlertableOpportunity {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly confidence: number;
  readonly price: number;
  readonly explanation: string;
}

export interface NotifyResult {
  readonly sent: boolean;
  readonly reason?: string;
}

interface AlertState {
  history: Alert[];
  /** Last alert time per symbol:timeframe key, for cooldown checks. */
  lastAlertAt: Record<string, number>;
}

const STORAGE_KEY = 'alerts';
const HISTORY_LIMIT = 200;

export class AlertEngine {
  private state: AlertState;

  constructor(
    private readonly store: KeyValueStore,
    private readonly channels: readonly AlertChannel[],
    private readonly options: { cooldownMs: number },
  ) {
    if (!(options.cooldownMs > 0)) {
      throw new RangeError(`cooldownMs must be > 0, got ${options.cooldownMs}`);
    }
    this.state = store.get<AlertState>(STORAGE_KEY) ?? { history: [], lastAlertAt: {} };
  }

  async notify(opportunity: AlertableOpportunity, timestamp: number): Promise<NotifyResult> {
    const key = `${opportunity.symbol}:${opportunity.timeframe}`;
    const last = this.state.lastAlertAt[key];
    if (last !== undefined && timestamp - last < this.options.cooldownMs) {
      const remainingMs = this.options.cooldownMs - (timestamp - last);
      return {
        sent: false,
        reason: `cooldown: ${opportunity.symbol} was alerted ${Math.round((timestamp - last) / 60000)}m ago (${Math.round(remainingMs / 60000)}m remaining)`,
      };
    }

    const alert: Alert = {
      id: `${key}:${timestamp}`,
      createdAt: timestamp,
      symbol: opportunity.symbol,
      timeframe: opportunity.timeframe,
      confidence: opportunity.confidence,
      title: `Qualified opportunity: ${opportunity.symbol}`,
      message:
        `${opportunity.symbol} (${opportunity.timeframe}) qualified at ` +
        `confidence ${opportunity.confidence.toFixed(0)} near ${opportunity.price}. ` +
        opportunity.explanation,
    };

    for (const channel of this.channels) {
      try {
        await channel.deliver(alert);
      } catch {
        // One broken channel must not block the others or the record.
      }
    }

    this.state.lastAlertAt[key] = timestamp;
    this.state.history.push(alert);
    if (this.state.history.length > HISTORY_LIMIT) {
      this.state.history = this.state.history.slice(-HISTORY_LIMIT);
    }
    this.persist();
    return { sent: true };
  }

  history(): readonly Alert[] {
    return this.state.history;
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.state);
  }
}
