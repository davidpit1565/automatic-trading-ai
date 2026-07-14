/**
 * Execution Control Layer — DESIGN ONLY (Stage 6 preparation).
 *
 * This file defines the contracts a future execution layer must satisfy.
 * There is deliberately NO implementation here and nothing imports network
 * or broker code: live order placement is out of scope until Stage 6, and
 * even then every live order requires explicit human confirmation.
 *
 * See docs/execution-architecture.md for the full design rationale.
 * Architecture tests enforce that this module stays implementation-free.
 */

import type { TradeRiskAssessment } from '../risk/riskEngine';

/** Paper mode simulates fills locally; live mode would talk to a broker. */
export type ExecutionMode = 'paper' | 'live';

/** Lifecycle of an order proposal. Nothing reaches 'submitted' without confirmation. */
export type OrderState =
  | 'proposed' // produced from an approved TradeRiskAssessment
  | 'awaiting-confirmation' // presented to the human, blocking
  | 'confirmed' // human explicitly approved THIS order
  | 'submitted' // sent to the broker (live) or the simulator (paper)
  | 'filled'
  | 'cancelled'
  | 'rejected';

/** A fully-specified order derived from a risk-approved assessment. */
export interface OrderIntent {
  readonly id: string;
  readonly createdAt: number;
  readonly mode: ExecutionMode;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: number;
  readonly limitPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** The risk assessment this order was derived from — full traceability. */
  readonly assessment: TradeRiskAssessment;
}

/**
 * Human confirmation gate. Implementations MUST block until an explicit
 * decision; there is no auto-approve path and no default answer.
 */
export interface ConfirmationGate {
  /** Present the order and wait for an explicit human yes/no. */
  requestConfirmation(intent: OrderIntent): Promise<ConfirmationDecision>;
}

export interface ConfirmationDecision {
  readonly intentId: string;
  readonly approved: boolean;
  readonly decidedAt: number;
  /** Who decided — required for the audit trail. */
  readonly decidedBy: string;
  readonly note?: string;
}

/**
 * Kill switch: a single control that halts ALL execution activity.
 * When engaged, every submit path must refuse immediately, and engaging
 * it must never require confirmation (stopping is always safe).
 */
export interface KillSwitch {
  isEngaged(): boolean;
  engage(reason: string): void;
  /** Disengaging DOES require explicit human action; never automatic. */
  disengage(confirmedBy: string): void;
}

/** Append-only audit log; every state transition is recorded. */
export interface AuditLogEntry {
  readonly timestamp: number;
  readonly intentId: string;
  readonly event: OrderState | 'kill-switch-engaged' | 'kill-switch-disengaged';
  readonly mode: ExecutionMode;
  readonly detail: string;
}

export interface AuditLog {
  append(entry: AuditLogEntry): void;
  entries(): readonly AuditLogEntry[];
}

/**
 * Broker abstraction. Revolut X is the first target; the interface is
 * broker-agnostic so others can be added without touching the layers above.
 * Implementations live behind the confirmation gate and kill switch —
 * nothing above this interface may talk to a broker directly.
 */
export interface BrokerAdapter {
  readonly name: string;
  readonly mode: ExecutionMode;
  /** Submit a CONFIRMED order. Must refuse when the kill switch is engaged. */
  submit(intent: OrderIntent): Promise<OrderStatusReport>;
  cancel(intentId: string): Promise<OrderStatusReport>;
  /** Broker-side open positions, for reconciliation. */
  fetchPositions(): Promise<BrokerPosition[]>;
}

export interface OrderStatusReport {
  readonly intentId: string;
  readonly state: OrderState;
  readonly filledQuantity: number;
  readonly avgFillPrice: number | null;
  readonly detail: string;
}

export interface BrokerPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly avgCost: number;
}

/**
 * Position synchronisation: compares local expectations with broker truth
 * and reports drift instead of silently correcting it — a human decides.
 */
export interface PositionSyncReport {
  readonly checkedAt: number;
  readonly matches: boolean;
  readonly differences: {
    readonly symbol: string;
    readonly localQuantity: number;
    readonly brokerQuantity: number;
  }[];
}
