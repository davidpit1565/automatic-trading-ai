/**
 * Paper broker adapter — the first implementation of the `BrokerAdapter`
 * contract (docs/execution-architecture.md, "What Stage 6 must add", item 1).
 *
 * Simulates fills locally against the existing paper `PortfolioEngine` — no
 * network, no real broker, `mode` fixed to `'paper'`. This exists to prove
 * the full `OrderIntent` state machine (proposed → awaiting-confirmation →
 * confirmed → submitted → filled) end-to-end before any real money or real
 * broker is involved.
 *
 * Deliberately NOT wired into `paperAutoPilot.ts`: that autopilot already
 * trades paper money autonomously and correctly has no confirmation step —
 * only a REAL broker adapter behind a REAL confirmation gate needs one. This
 * class is the machinery Stage 6's real path will reuse the shape of, not a
 * new autonomous trading path.
 */

import type { BrokerAdapter, BrokerPosition, KillSwitch, OrderIntent, OrderStatusReport } from './types';
import type { PortfolioEngine } from '../position/portfolioEngine';

export class PaperBrokerAdapter implements BrokerAdapter {
  readonly name = 'paper-broker';
  readonly mode = 'paper' as const;

  constructor(
    private readonly portfolio: PortfolioEngine,
    private readonly killSwitch: KillSwitch,
  ) {}

  async submit(intent: OrderIntent): Promise<OrderStatusReport> {
    if (this.killSwitch.isEngaged()) {
      return this.report(intent.id, 'cancelled', 'kill switch engaged');
    }
    if (intent.mode !== 'paper') {
      return this.report(intent.id, 'rejected', 'PaperBrokerAdapter only accepts paper-mode orders');
    }
    if (intent.side === 'buy') return this.fillBuy(intent);
    return this.fillSell(intent);
  }

  private fillBuy(intent: OrderIntent): OrderStatusReport {
    const opened = this.portfolio.openFromAssessment(intent.assessment, { timestamp: intent.createdAt });
    if (!opened.ok) return this.report(intent.id, 'rejected', opened.error);
    return {
      intentId: intent.id,
      state: 'filled',
      filledQuantity: opened.value.quantity,
      avgFillPrice: opened.value.entryPrice,
      detail: 'paper fill (buy)',
    };
  }

  private fillSell(intent: OrderIntent): OrderStatusReport {
    const existing = this.portfolio.openPositions().find((p) => p.symbol === intent.symbol);
    if (!existing) return this.report(intent.id, 'rejected', `no open ${intent.symbol} position to sell`);
    const exited = this.portfolio.exit(existing.id, {
      quantity: intent.quantity,
      price: intent.limitPrice,
      timestamp: intent.createdAt,
      reason: 'manual',
    });
    if (!exited.ok) return this.report(intent.id, 'rejected', exited.error);
    return {
      intentId: intent.id,
      state: 'filled',
      filledQuantity: intent.quantity,
      avgFillPrice: intent.limitPrice,
      detail: 'paper fill (sell)',
    };
  }

  async cancel(intentId: string): Promise<OrderStatusReport> {
    // Every submit() above resolves synchronously to a terminal state (filled
    // or rejected) — nothing is ever left in a cancellable in-flight state,
    // so this is always a no-op acknowledgement.
    return this.report(intentId, 'cancelled', 'paper broker never queues an order to cancel');
  }

  async fetchPositions(): Promise<BrokerPosition[]> {
    return this.portfolio.openPositions().map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avgCost: p.entryPrice,
    }));
  }

  private report(
    intentId: string,
    state: OrderStatusReport['state'],
    detail: string,
  ): OrderStatusReport {
    return { intentId, state, filledQuantity: 0, avgFillPrice: null, detail };
  }
}
