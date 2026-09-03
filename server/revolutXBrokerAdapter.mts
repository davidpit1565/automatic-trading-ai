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
import type { Instrument } from '../src/core/types';

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

/**
 * Translates this project's internal instrument symbol (e.g. Kraken's
 * 'XBTEUR') to the candidate Revolut X pair symbol (e.g. 'BTC-EUR') —
 * closing the open question from PR #101/#102: internal asset codes don't
 * match Revolut X's own 'BASE-QUOTE' format as-is.
 *
 * Deliberately NOT string-parsing `internalSymbol` itself (splitting
 * 'BTCEUR' by guessing where the base ends and the quote begins is exactly
 * the kind of guess this project's rules forbid for money-affecting code).
 * Instead it looks up the SAME base/quote breakdown the trading engine
 * itself already uses to know what that symbol even means (`base`/`quote`
 * on `Instrument`, e.g. `src/core/data/krakenPublic.ts`'s
 * `CURATED_INSTRUMENTS`) and reformats that.
 *
 * Returns `null` — never guesses — when `internalSymbol` isn't found in
 * `instruments` at all. A non-null result is still only a CANDIDATE: it is
 * not verified to actually be a Revolut X pair until checked against
 * `RevolutXBrokerAdapter.listTradablePairs()` (e.g. Revolut X may not list
 * every quote currency the internal instrument list does).
 */
export function toRevolutXSymbol(internalSymbol: string, instruments: readonly Instrument[]): string | null {
  const found = instruments.find((i) => i.symbol === internalSymbol);
  if (!found) return null;
  return `${found.base}-${found.quote}`;
}

/** Mirrors RevolutXClient.getInstruments()'s own parsing of the same
 * endpoint (src/core/data/revolutClient.ts) — response maps symbols to pair
 * configuration, e.g. { "BTC-USD": { ... } }, optionally wrapped in { data }.
 * Only keys that actually split into a base and quote asset (e.g.
 * 'BTC-USD') are reported; a malformed or unexpectedly-shaped response
 * (e.g. an array) yields no symbols rather than bogus ones. */
function readPairSymbols(json: unknown): string[] {
  if (!isRecord(json)) return [];
  const body = isRecord(json.data) && !Array.isArray(json.data) ? json.data : json;
  if (Array.isArray(body)) return [];
  return Object.keys(body).filter((symbol) => {
    const [base, quote] = symbol.split('-');
    return Boolean(base && quote);
  });
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
      // A network failure here (timeout, dropped connection) means the
      // RESPONSE was lost, not necessarily the order — Revolut X may have
      // already accepted and be filling it. Checked directly against
      // Revolut X's own API docs (2026-09-02): there is no way to look up
      // an order by client_order_id, only by the venue_order_id a
      // SUCCESSFUL placement response returns — which this branch, by
      // definition, never received. So this project genuinely cannot
      // verify what happened here from documented capabilities alone; a
      // plain 'rejected' would be a lie of omission (there is no OrderState
      // value for "unknown, don't assume" either). Rather than guess,
      // this auto-engages the kill switch — halting all further live
      // trading until a human manually checks Revolut X directly and
      // explicitly /resume's — since automated certainty isn't available,
      // the safe fallback is mandatory human involvement, not a hopeful
      // assumption in either direction.
      this.killSwitch.engage(
        `order ${intent.id}: network failure before a response was received (${message}) — Revolut X may or may not have placed it; verify manually in the Revolut X app before /resume`,
      );
      return this.reportAndAudit(
        intent.id,
        'rejected',
        `order request failed before a response was received (${message}) — Revolut X may still have received it; kill switch engaged automatically, verify manually before resuming`,
      );
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

  /**
   * Real, current pair symbols Revolut X trades (e.g. 'BTC-USD') — the
   * authoritative source for whether a symbol this project wants to trade
   * actually exists here, and in what form. Callers building a live
   * `OrderIntent` should translate to a candidate symbol with
   * `toRevolutXSymbol` first, then verify the RESULT against this list
   * before ever submitting — refusing rather than guessing when either
   * step fails. See `server/liveOrchestrator.mts`.
   */
  async listTradablePairs(): Promise<string[]> {
    try {
      const result = await this.request('GET', '/configuration/pairs');
      if (!result.ok) {
        // A failure here is otherwise INVISIBLE — the caller (verifySymbolExists,
        // liveOrchestrator.mts) can only ever report "could not verify",
        // identical wording whether the pair genuinely doesn't exist or this
        // call itself failed (auth, network, wrong path). Audited here with the
        // real HTTP status/body so a silent go-live blocker is diagnosable from
        // the committed audit log instead of a guess (found 2026-09-03: the
        // first real attempt against production silently refused every entry
        // with no visible reason beyond that ambiguous message).
        this.audit.append({
          timestamp: Date.now(),
          intentId: 'list-tradable-pairs',
          event: 'rejected',
          mode: 'live',
          detail: `GET /configuration/pairs failed: HTTP ${result.status} — ${JSON.stringify(result.json)}`,
        });
        return [];
      }
      return readPairSymbols(result.json);
    } catch (cause) {
      this.audit.append({
        timestamp: Date.now(),
        intentId: 'list-tradable-pairs',
        event: 'rejected',
        mode: 'live',
        detail: `GET /configuration/pairs threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return [];
    }
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
