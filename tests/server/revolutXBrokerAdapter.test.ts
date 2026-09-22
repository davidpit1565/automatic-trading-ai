import { generateKeyPairSync, verify } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type { OrderIntent } from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import type { Instrument } from '../../src/core/types';
import { deterministicClientOrderId, RevolutXBrokerAdapter, safeDecimalString, toRevolutXSymbol } from '../../server/revolutXBrokerAdapter.mts';

// A fresh Ed25519 test key pair per run — not a secret, mirrors signing.test.ts.
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('ed25519');
const TEST_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY.export({ type: 'pkcs8', format: 'pem' }).toString();

/** Cryptographically verifies a signature header was actually computed over
 * the exact request that was sent — the only way to catch a signed-path
 * mismatch (e.g. a doubled '/api' prefix) that a merely-truthy check misses. */
function verifiesAgainstRealRequest(call: Call): boolean {
  const timestamp = call.headers['X-Revx-Timestamp'];
  const signature = call.headers['X-Revx-Signature']!;
  const realPath = new URL(call.url).pathname;
  const payload = `${timestamp}${call.method.toUpperCase()}${realPath}${call.body ?? ''}`;
  return verify(null, Buffer.from(payload, 'utf8'), TEST_PUBLIC_KEY, Buffer.from(signature, 'base64'));
}

function approvedAssessment(): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'BTCEUR',
    entry: 100,
    stopLoss: 95,
    takeProfit: 115,
    positionSize: 2,
    positionValue: 200,
    riskAmount: 10,
    riskPercentage: 1,
    rewardRiskRatio: 3,
    portfolioExposure: 2,
    reasons: [],
    warnings: [],
  };
}

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'BTC-USD:1:0',
    createdAt: 1_000,
    mode: 'live',
    symbol: 'BTC-USD',
    side: 'buy',
    quantity: 2,
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    assessment: approvedAssessment(),
    ...overrides,
  };
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const response = responses[Math.min(index, responses.length - 1)]!;
    index++;
    return new Response(response.body === null ? null : JSON.stringify(response.body), {
      status: response.status,
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function credentials() {
  return { apiKey: 'test-api-key', privateKeyPem: TEST_PRIVATE_KEY_PEM };
}

describe('RevolutXBrokerAdapter', () => {
  let store: MemoryStore;
  let audit: PersistedAuditLog;
  let killSwitch: PersistedKillSwitch;

  beforeEach(() => {
    store = new MemoryStore();
    audit = new PersistedAuditLog(store);
    killSwitch = new PersistedKillSwitch(store);
  });

  it('declares itself live-mode, network-backed', () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: {} }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);
    expect(adapter.name).toBe('revolut-x');
    expect(adapter.mode).toBe('live');
  });

  it('places an order, reads back its fill, and reports it filled', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-1', client_order_id: 'BTC-USD:1:0', state: 'new' }] } },
      {
        status: 200,
        body: { data: { status: 'filled', filled_quantity: '2', average_fill_price: '99.5' } },
      },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report).toEqual({
      intentId: 'BTC-USD:1:0',
      state: 'filled',
      filledQuantity: 2,
      avgFillPrice: 99.5,
      detail: 'Revolut X order venue-1: filled',
    });
    // First call places the order, second reads its status back.
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://revx.revolut.com/api/1.0/orders');
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      // Revolut X requires client_order_id to be a real UUID (confirmed
      // against their own API docs, 2026-09-03) — derived deterministically
      // from intent.id, while intent.id/report.intentId below stay the
      // original 'BTC-USD:1:0' used for internal tracking.
      client_order_id: deterministicClientOrderId('BTC-USD:1:0'),
      symbol: 'BTC-USD',
      side: 'buy',
      order_configuration: { limit: { base_size: '2', price: '100' } },
    });
    expect(calls[0]!.headers['X-Revx-API-Key']).toBe('test-api-key');
    expect(verifiesAgainstRealRequest(calls[0]!)).toBe(true);
    expect(calls[1]).toMatchObject({ method: 'GET', url: 'https://revx.revolut.com/api/1.0/orders/venue-1' });
    expect(verifiesAgainstRealRequest(calls[1]!)).toBe(true);
    // Audited under the FINAL observed state, not the placement acknowledgement.
    expect(audit.entries().at(-1)).toMatchObject({ intentId: 'BTC-USD:1:0', event: 'filled' });
  });

  it('sends a clean, rounded decimal quantity/price to the broker, never raw binary-float noise (real gap found 2026-09-03, full-system audit: the human-facing Telegram confirmation shows a rounded quantity via a DIFFERENT formatter — formatQty — while the actual order body used to send String(intent.quantity) unrounded, so what was approved and what was submitted were not guaranteed identical)', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-2', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    await adapter.submit(intent({ quantity: 0.00011673469387755104, limitPrice: 0.1 + 0.2 }));

    expect(JSON.parse(calls[0]!.body!).order_configuration).toEqual({
      limit: { base_size: '0.00011673', price: '0.3' },
    });
  });

  it('safeDecimalString rounds to 8 decimals and strips trailing zeros without producing scientific notation', () => {
    expect(safeDecimalString(0.1 + 0.2)).toBe('0.3');
    expect(safeDecimalString(0.00011673469387755104)).toBe('0.00011673');
    expect(safeDecimalString(100)).toBe('100');
    expect(safeDecimalString(0)).toBe('0');
    expect(safeDecimalString(68620)).toBe('68620');
  });

  it('also accepts a bare object under data (not just the documented array) when reading venue_order_id back', async () => {
    // Real incident (2026-09-03): an order Revolut X actually FILLED (confirmed
    // directly in the Revolut X app) was reported to David as rejected because
    // this only ever accepted the array shape their docs show. Defensive
    // fallback so a real-world response shape drift doesn't silently drop a
    // genuine fill again.
    const { fetchFn } = fakeFetch([
      { status: 200, body: { data: { venue_order_id: 'venue-5', client_order_id: 'x', state: 'new' } } },
      { status: 200, body: { data: { status: 'filled', filled_quantity: '2', average_fill_price: '99.5' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('filled');
    expect(audit.entries().at(-1)).toMatchObject({ event: 'filled' });
  });

  it('includes the raw response body when venue_order_id truly cannot be found — so a repeat is diagnosable, not silently discarded', async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { data: [] } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('missing venue_order_id');
    expect(report.detail).toContain('raw response');
    expect(report.detail).toContain('"data":[]');
  });

  it("sends a real UUID as client_order_id, since Revolut X rejects anything else — real HTTP 400 twice in production, 2026-09-03: first \"Invalid client order ID: 'live-entry:XBTEUR'\", then still \"Invalid client order ID: 'live-entry-XBTEUR'\" after merely stripping the ':'", async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-9', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent({ id: 'live-entry:XBTEUR' }));

    const sentId = JSON.parse(calls[0]!.body!).client_order_id;
    expect(sentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Internal tracking (report.intentId, audit log) keeps the original id.
    expect(report.intentId).toBe('live-entry:XBTEUR');
  });

  it('deterministicClientOrderId derives the SAME uuid-shaped id for the same intent id every time (an accidental retry must not look like a brand new order)', () => {
    const first = deterministicClientOrderId('live-entry:XBTEUR');
    const second = deterministicClientOrderId('live-entry:XBTEUR');
    expect(first).toBe(second);
    expect(deterministicClientOrderId('live-entry:ETHEUR')).not.toBe(first);
  });

  it('reports an order still open as submitted, not fabricated as filled', async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-2', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('submitted');
    expect(report.filledQuantity).toBe(0);
    expect(report.avgFillPrice).toBeNull();
  });

  it('reports submitted (not filled) when the follow-up status read STILL fails after retries, and auto-engages the kill switch (real gap found 2026-09-03: a REAL order placed here can genuinely fill while its status is unreadable, and went completely untracked — no stop-loss, invisible to /sell — until a human happened to notice by checking Revolut X directly)', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-3', client_order_id: 'x', state: 'new' }] } },
      { status: 500, body: { error: 'upstream hiccup' } }, // every GET attempt hits this (fakeFetch repeats the last entry)
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(killSwitch.isEngaged()).toBe(false);
    const report = await adapter.submit(intent());

    expect(report.state).toBe('submitted');
    expect(report.detail).toContain('venue-3');
    expect(report.detail).toContain('verify manually');
    expect(killSwitch.isEngaged()).toBe(true);
    // POST + one GET per attempt (initial + 3 retries) — genuinely exhausted, not a single blip.
    expect(calls.length).toBe(5);
  });

  it('a single transient status-read blip recovers on retry WITHOUT engaging the kill switch — real incident, 2026-09-21: this exact single-attempt gap halted all live trading (entries AND exits, every symbol) for ~40 hours over one flaky follow-up read on an order that had actually filled fine', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-6', client_order_id: 'x', state: 'new' }] } },
      { status: 500, body: { error: 'upstream hiccup' } }, // attempt 1: transient failure
      { status: 200, body: { data: { status: 'filled', filled_quantity: '2', average_fill_price: '99.5' } } }, // attempt 2: succeeds
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('filled');
    expect(report.filledQuantity).toBe(2);
    expect(killSwitch.isEngaged()).toBe(false);
    expect(calls.length).toBe(3); // POST + 2 GET attempts, not the full retry budget
  });

  describe('instant Telegram alert on an auto-engaged kill switch (2026-09-22)', () => {
    // Real incident, 2026-09-20/21: the kill switch auto-engaged and David
    // only found out ~40 hours later, when he happened to ask about it —
    // the daily digest DOES include kill-switch state (readLiveSummary), but
    // only at the next 08:00/22:00 slot. These tests prove every auto-engage
    // path also fires an immediate Telegram message, not just an audit entry.
    function fakeTelegramConfig() {
      const sent: string[] = [];
      const fetchFn = (async (url: string, init?: { body?: string }) => {
        if (String(url).includes('/sendMessage')) {
          sent.push(JSON.parse(init!.body!).text);
          return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
        }
        throw new Error(`unexpected Telegram endpoint: ${url}`);
      }) as unknown as typeof fetch;
      return { telegram: { token: 'T', chatId: 'C', fetchFn }, sent };
    }

    it('alerts immediately when the fill-status read never confirms after retries', async () => {
      const { fetchFn } = fakeFetch([
        { status: 200, body: { data: [{ venue_order_id: 'venue-alert-1', client_order_id: 'x', state: 'new' }] } },
        { status: 500, body: { error: 'upstream down' } },
      ]);
      const { telegram, sent } = fakeTelegramConfig();
      const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn, undefined, telegram);

      await adapter.submit(intent());

      expect(killSwitch.isEngaged()).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('🚨');
      expect(sent[0]).toContain('venue-alert-1');
    });

    it('alerts immediately on a network failure before any response was received', async () => {
      const throwingFetch = (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch;
      const { telegram, sent } = fakeTelegramConfig();
      const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), throwingFetch, undefined, telegram);

      await adapter.submit(intent());

      expect(killSwitch.isEngaged()).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('ECONNRESET');
    });

    it('alerts immediately on a "duplicate client_order_id" rejection', async () => {
      const { fetchFn } = fakeFetch([
        { status: 400, body: { message: "An order with the client_order_id 'abc' has already been placed.", error_id: 'x' } },
      ]);
      const { telegram, sent } = fakeTelegramConfig();
      const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn, undefined, telegram);

      await adapter.submit(intent());

      expect(killSwitch.isEngaged()).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('already been placed');
    });

    it('never engages the kill switch or sends an alert on a clean fill — no false alarms', async () => {
      const { fetchFn } = fakeFetch([
        { status: 200, body: { data: [{ venue_order_id: 'venue-clean', client_order_id: 'x', state: 'new' }] } },
        { status: 200, body: { data: { status: 'filled', filled_quantity: '2', average_fill_price: '99.5' } } },
      ]);
      const { telegram, sent } = fakeTelegramConfig();
      const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn, undefined, telegram);

      await adapter.submit(intent());

      expect(killSwitch.isEngaged()).toBe(false);
      expect(sent).toHaveLength(0);
    });

    it('does not attempt a Telegram send at all when no telegram config is passed (existing behavior, unaffected)', async () => {
      const throwingFetch = (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;
      const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), throwingFetch);

      await expect(adapter.submit(intent())).resolves.toBeDefined();
      expect(killSwitch.isEngaged()).toBe(true);
    });
  });

  it('treats a "duplicate client_order_id" rejection as AMBIGUOUS (not a clean, zero-exposure rejection) and auto-engages the kill switch — real production message, 2026-09-03: strong evidence an earlier attempt actually went through, which this project cannot look up by client_order_id to confirm', async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 400,
        body: { message: "An order with the client_order_id 'abc' has already been placed.", error_id: 'x' },
      },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(killSwitch.isEngaged()).toBe(false);
    const report = await adapter.submit(intent());

    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('already placed');
    expect(report.detail).toContain('verify manually');
    expect(killSwitch.isEngaged()).toBe(true);
  });

  it('is explicit that a network failure during placement is AMBIGUOUS, not a confirmed rejection, and auto-engages the kill switch', async () => {
    const throwingFetch = (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), throwingFetch);

    expect(killSwitch.isEngaged()).toBe(false);
    const report = await adapter.submit(intent());

    expect(report.state).toBe('rejected');
    // No OrderState value exists for "unknown, don't assume" — but the
    // detail must never imply certainty this project doesn't have.
    expect(report.detail).toContain('may still have received it');
    expect(report.detail).toContain('verify manually');
    // Revolut X's API has no order lookup by client_order_id (only by a
    // venue_order_id this branch never received) — automated certainty is
    // genuinely unavailable, so this must halt further live trading rather
    // than silently guess either way.
    expect(killSwitch.isEngaged()).toBe(true);
  });

  it('rejects when Revolut X refuses the order placement itself', async () => {
    const { fetchFn } = fakeFetch([{ status: 400, body: { error: 'insufficient funds' } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('400');
  });

  it('truncates the quantity to the decimal precision Revolut X states and retries once (real incidents, 2026-09-17: ENA rejected at 4 decimals, DOT at 5 — our fixed 8-decimal formatting exceeded both, wasting an already-approved trade)', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 400, body: { message: 'base_size precision must not exceed 4 decimal places' } },
      { status: 200, body: { data: [{ venue_order_id: 'venue-precision', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent({ quantity: 1.23456789 }));

    expect(report.state).toBe('submitted');
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[1]!.body!).order_configuration.limit.base_size).toBe('1.2345');
    // Same client_order_id on the retry — the first attempt was a clean HTTP
    // 400, no order was ever created, so reusing it is safe.
    expect(JSON.parse(calls[1]!.body!).client_order_id).toBe(JSON.parse(calls[0]!.body!).client_order_id);
  });

  it('reports rejected (no infinite retry) when the truncated quantity is rejected again', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 400, body: { message: 'base_size precision must not exceed 4 decimal places' } },
      { status: 400, body: { message: 'insufficient funds' } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent({ quantity: 1.23456789 }));

    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('insufficient funds');
    expect(calls).toHaveLength(2); // exactly one retry, never looped further
  });

  it('does not retry when the stated precision would not actually change the quantity (falls through to the plain rejection)', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 400, body: { message: 'base_size precision must not exceed 4 decimal places' } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent({ quantity: 2 })); // already exact at 4 decimals

    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('precision');
    expect(calls).toHaveLength(1); // no pointless retry
  });

  it('never sends the order at all when the kill switch is engaged', async () => {
    killSwitch.engage('testing');
    const { fetchFn, calls } = fakeFetch([{ status: 200, body: {} }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent());

    expect(report.state).toBe('cancelled');
    expect(calls).toHaveLength(0);
  });

  it('refuses a paper-mode intent — this adapter only ever places real orders', async () => {
    const { fetchFn, calls } = fakeFetch([{ status: 200, body: {} }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const report = await adapter.submit(intent({ mode: 'paper' }));

    expect(report.state).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it('cancels a known order by its Revolut X venue id', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-4', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
      { status: 204, body: null },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);
    await adapter.submit(intent({ id: 'to-cancel' }));

    const report = await adapter.cancel('to-cancel');

    expect(report.state).toBe('cancelled');
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: 'https://revx.revolut.com/api/1.0/orders/venue-4' });
    expect(verifiesAgainstRealRequest(calls[2]!)).toBe(true);
  });

  it('refuses to cancel an intent it never placed, rather than silently no-oping', async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: {} }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    await expect(adapter.cancel('never-placed')).rejects.toThrow(/no known Revolut X venue order id/);
  });

  it('never sends a real cancel request while the kill switch is engaged (found in review, 2026-09-03: unlike submit(), cancel() had no kill-switch check at all)', async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { data: [{ venue_order_id: 'venue-5', client_order_id: 'x', state: 'new' }] } },
      { status: 200, body: { data: { status: 'new' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);
    await adapter.submit(intent({ id: 'to-cancel' }));
    const callsBeforeCancel = calls.length;

    killSwitch.engage('test');
    const report = await adapter.cancel('to-cancel');

    expect(report.state).toBe('cancelled');
    expect(report.detail).toMatch(/kill switch engaged/);
    expect(calls).toHaveLength(callsBeforeCancel); // no DELETE request was ever sent
  });

  it('reports spot balances as broker positions, dropping zero balances', async () => {
    const { fetchFn, calls } = fakeFetch([
      {
        status: 200,
        body: [
          { currency: 'BTC', available: '0.5', reserved: '0', total: '0.5' },
          { currency: 'USD', available: '0', reserved: '0', total: '0' },
        ],
      },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const positions = await adapter.fetchPositions();

    expect(positions).toEqual([{ symbol: 'BTC', quantity: 0.5, avgCost: 0 }]);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://revx.revolut.com/api/1.0/balances' });
    expect(verifiesAgainstRealRequest(calls[0]!)).toBe(true);
  });

  it('returns no positions when the balances request fails, rather than reporting stale/wrong data', async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: { error: 'down' } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.fetchPositions()).toEqual([]);
  });

  it('lists the real tradable pair symbols, for verifying a symbol before ever proposing it', async () => {
    const { fetchFn, calls } = fakeFetch([
      {
        status: 200,
        body: { data: { 'BTC-USD': { base: 'BTC', quote: 'USD', active: true }, 'ETH-USD': { base: 'ETH', quote: 'USD', active: true } } },
      },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    const pairs = await adapter.listTradablePairs();

    expect(pairs).toEqual(['BTC-USD', 'ETH-USD']);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://revx.revolut.com/api/1.0/configuration/pairs' });
    expect(verifiesAgainstRealRequest(calls[0]!)).toBe(true);
  });

  it("parses the REAL production key shape ('/'-separated, e.g. 'LINK/USD') — found 2026-09-03: the first real /buy attempt silently saw 0 pairs because this used to split keys on '-', which never matched any real key", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { 'LINK/USD': { base: 'LINK', quote: 'USD', status: 'active' }, 'BTC/EUR': { base: 'BTC', quote: 'EUR', status: 'active' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.listTradablePairs()).toEqual(['LINK/USD', 'BTC/EUR']);
  });

  it('excludes entries missing base/quote fields rather than guessing from the key', async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { 'BTC-USD': { active: true }, 'ETH/USD': { base: 'ETH', quote: 'USD' } } },
    ]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.listTradablePairs()).toEqual(['ETH/USD']);
  });

  it('audits the raw response body when a 200 OK yields 0 parseable symbols (found 2026-09-03: otherwise indistinguishable from an HTTP failure)', async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { 'BTC-USD': { active: true } } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.listTradablePairs()).toEqual([]);
    const entry = audit.entries().find((e) => e.intentId === 'list-tradable-pairs');
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain('0 parseable symbols');
    expect(entry!.detail).toContain('BTC-USD');
  });

  it('returns no pairs when the configuration request fails, rather than reporting a stale/wrong list, and audits the REAL HTTP status/body (found undiagnosable in review, 2026-09-03 — the first real go-live attempt silently refused every entry with no visible reason)', async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: { error: 'down' } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.listTradablePairs()).toEqual([]);
    const entry = audit.entries().find((e) => e.intentId === 'list-tradable-pairs');
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain('HTTP 500');
    expect(entry!.detail).toContain('down');
  });

  it('returns no pairs (never throws) when the request itself throws, e.g. a timeout, and audits the thrown error message', async () => {
    const throwingFetch = (async () => {
      throw new Error('network timeout');
    }) as typeof fetch;
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), throwingFetch);

    await expect(adapter.listTradablePairs()).resolves.toEqual([]);
    const entry = audit.entries().find((e) => e.intentId === 'list-tradable-pairs');
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain('network timeout');
  });

  it('ignores a malformed pairs response (e.g. an array) rather than reporting bogus symbols', async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { data: ['BTC-USD', 'ETH-USD'] } }]);
    const adapter = new RevolutXBrokerAdapter(store, audit, killSwitch, credentials(), fetchFn);

    expect(await adapter.listTradablePairs()).toEqual([]);
  });
});

describe('toRevolutXSymbol', () => {
  const instruments: Instrument[] = [
    { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' },
    { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' },
  ];

  it('translates an internal instrument symbol to the broker BASE/QUOTE format using its real base/quote, not string-guessing', () => {
    expect(toRevolutXSymbol('XBTEUR', instruments)).toBe('BTC/EUR');
    expect(toRevolutXSymbol('ETHEUR', instruments)).toBe('ETH/EUR');
  });

  it('returns null — never guesses — for a symbol not in the known instrument list', () => {
    expect(toRevolutXSymbol('DOGEEUR', instruments)).toBeNull();
  });
});
