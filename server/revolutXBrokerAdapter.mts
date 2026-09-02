/**
 * Real, network-backed Revolut X broker adapter — implements the
 * `BrokerAdapter` contract (docs/execution-architecture.md, "What Stage 6
 * must add", item "Revolut X adapter behind a separate, explicitly-scoped
 * API key").
 *
 * Lives in server/, not src/core/execution, for the same reason
 * `telegramConfirmationGate.mts` does: real network I/O. The architecture
 * test (tests/ui/architecture.test.ts) only restricts src/ from implementing
 * `BrokerAdapter` outside the paper simulator — this file is the intended
 * real implementation, using order-capable credentials that must be
 * separately scoped from the existing read-only market-data key
 * (`server/revxProxy.mjs`'s REVX_API_KEY/REVX_PRIVATE_KEY).
 *
 * Reuses the exact Ed25519 signing already built and tested for read-only
 * calls (`server/signing.mjs`) — same scheme, applied to POST/DELETE/GET on
 * /orders and /balances instead of GET on market-data paths.
 *
 * This class only submits ALREADY-CONFIRMED intents — it has no say in
 * whether an order happens, only in how it's placed once a human approved it
 * via ConfirmationGate. `submit` does not poll for a fill: it places the
 * order, reads its state back once, and reports honestly (submitted, not
 * fabricated as filled) when Revolut X hasn't filled it yet. A poller that
 * follows up on still-open orders is wiring-layer work, not yet built —
 * matching the project's current stage (nothing calls this class from a
 * running orchestrator loop yet).
 */

import { buildAuthHeaders } from './signing.mjs';
import type {
  AuditLog,
  BrokerAdapter,
  BrokerPosition,
  KillSwitch,
  OrderIntent,
  OrderState,
  OrderStatusReport,
} from '../src/core/execution/types';
import type { KeyValueStore } from '../src/core/data/storage';

const API_BASE = 'https://revx.revolut.com';
const API_PREFIX = '/api/1.0';
const ORDER_MAP_KEY = 'revolut-x-order-map';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RevolutXCredentials {
  readonly apiKey: string;
  readonly privateKeyPem: string;
}

interface RevolutXOrderDetail {
  readonly status: string;
  readonly filled_quantity?: string;
  readonly average_fill_price?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOrderDetail(json: unknown): RevolutXOrderDetail | null {
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const data = json.data;
  if (typeof data.status !== 'string') return null;
  return {
    status: data.status,
    filled_quantity: typeof data.filled_quantity === 'string' ? data.filled_quantity : undefined,
    average_fill_price: typeof data.average_fill_price === 'string' ? data.average_fill_price : null,
  };
}

function readVenueOrderId(json: unknown): string | null {
  if (!isRecord(json) || !Array.isArray(json.data)) return null;
  const first = json.data[0];
  if (!isRecord(first) || typeof first.venue_order_id !== 'string') return null;
  return first.venue_order_id;
}

function readBalances(json: unknown): { currency: string; total: number }[] {
  if (!Array.isArray(json)) return [];
  const balances: { currency: string; total: number }[] = [];
  for (const row of json) {
    if (!isRecord(row) || typeof row.currency !== 'string' || typeof row.total !== 'string') continue;
    balances.push({ currency: row.currency, total: Number(row.total) });
  }
  return balances;
}

/** Maps Revolut X's own status vocabulary onto this project's OrderState. */
function mapOrderStatus(status: string): OrderState {
  switch (status) {
    case 'filled':
      return 'filled';
    case 'cancelled':
      return 'cancelled';
    case 'rejected':
      return 'rejected';
    case 'new':
    case 'partially_filled':
      return 'submitted';
    default:
      return 'submitted';
  }
}

interface RawResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: unknown;
}

/** Real, network-backed BrokerAdapter. Every submit() call requires the
 * caller to have already run the intent through ConfirmationGate — this
 * class has no auto-approve path of its own. */
export class RevolutXBrokerAdapter implements BrokerAdapter {
  readonly name = 'revolut-x';
  readonly mode = 'live' as const;

  constructor(
    private readonly store: KeyValueStore,
    private readonly audit: AuditLog,
    private readonly killSwitch: KillSwitch,
    private readonly credentials: RevolutXCredentials,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private orderMap(): Record<string, string> {
    return this.store.get<Record<string, string>>(ORDER_MAP_KEY) ?? {};
  }

  private rememberVenueOrderId(intentId: string, venueOrderId: string): void {
    const map = this.orderMap();
    map[intentId] = venueOrderId;
    this.store.set(ORDER_MAP_KEY, map);
  }

  private async request(method: string, path: string, body?: unknown): Promise<RawResponse> {
    const fullPath = `${API_PREFIX}${path}`;
    const bodyText = body !== undefined ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...buildAuthHeaders({
        apiKey: this.credentials.apiKey,
        privateKeyPem: this.credentials.privateKeyPem,
        method,
        path: fullPath,
        body: bodyText,
      }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${API_BASE}${fullPath}`, {
        method,
        headers,
        body: body !== undefined ? bodyText : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      const json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
      return { ok: response.ok, status: response.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async submit(intent: OrderIntent): Promise<OrderStatusReport> {
    if (this.killSwitch.isEngaged()) {
      return this.reportAndAudit(intent.id, 'cancelled', 'kill switch engaged — order not sent');
    }
    if (intent.mode !== 'live') {
      return this.reportAndAudit(intent.id, 'rejected', 'RevolutXBrokerAdapter only accepts live-mode orders');
    }

    const body = {
      client_order_id: intent.id,
      symbol: intent.symbol,
      side: intent.side,
      order_configuration: {
        limit: {
          base_size: String(intent.quantity),
          price: String(intent.limitPrice),
        },
      },
    };

    let placed: RawResponse;
    try {
      placed = await this.request('POST', '/orders', body);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return this.reportAndAudit(intent.id, 'rejected', `order request failed: ${message}`);
    }
    if (!placed.ok) {
      return this.reportAndAudit(intent.id, 'rejected', `Revolut X rejected the order: HTTP ${placed.status}`);
    }
    const venueOrderId = readVenueOrderId(placed.json);
    if (!venueOrderId) {
      return this.reportAndAudit(intent.id, 'rejected', 'Revolut X response missing venue_order_id');
    }
    this.rememberVenueOrderId(intent.id, venueOrderId);

    // One follow-up read for the real fill picture — no wait-loop here.
    const detail = await this.fetchOrderDetail(venueOrderId);
    if (!detail) {
      return this.reportAndAudit(intent.id, 'submitted', `order ${venueOrderId} placed; status not yet confirmable`);
    }
    return this.reportAndAudit(
      intent.id,
      mapOrderStatus(detail.status),
      `Revolut X order ${venueOrderId}: ${detail.status}`,
      detail.filled_quantity !== undefined ? Number(detail.filled_quantity) : 0,
      detail.average_fill_price !== null && detail.average_fill_price !== undefined
        ? Number(detail.average_fill_price)
        : null,
    );
  }

  private async fetchOrderDetail(venueOrderId: string): Promise<RevolutXOrderDetail | null> {
    try {
      const result = await this.request('GET', `/orders/${venueOrderId}`);
      if (!result.ok) return null;
      return readOrderDetail(result.json);
    } catch {
      return null;
    }
  }

  async cancel(intentId: string): Promise<OrderStatusReport> {
    const venueOrderId = this.orderMap()[intentId];
    if (!venueOrderId) {
      throw new Error(`cannot cancel order ${intentId}: no known Revolut X venue order id for it`);
    }
    try {
      const result = await this.request('DELETE', `/orders/${venueOrderId}`);
      if (!result.ok && result.status !== 204) {
        return this.reportAndAudit(intentId, 'rejected', `cancel failed: HTTP ${result.status}`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return this.reportAndAudit(intentId, 'rejected', `cancel request failed: ${message}`);
    }
    return this.reportAndAudit(intentId, 'cancelled', `Revolut X order ${venueOrderId} cancelled`);
  }

  async fetchPositions(): Promise<BrokerPosition[]> {
    const result = await this.request('GET', '/balances');
    if (!result.ok) return [];
    return readBalances(result.json)
      .filter((b) => b.total > 0)
      .map((b) => ({
        symbol: b.currency,
        quantity: b.total,
        // Revolut X's balances endpoint carries no cost basis — only local
        // state knows entry price. Reconciliation compares quantity only.
        avgCost: 0,
      }));
  }

  private reportAndAudit(
    intentId: string,
    state: OrderState,
    detail: string,
    filledQuantity = 0,
    avgFillPrice: number | null = null,
  ): OrderStatusReport {
    this.audit.append({ timestamp: Date.now(), intentId, event: state, mode: 'live', detail });
    return { intentId, state, filledQuantity, avgFillPrice, detail };
  }
}
