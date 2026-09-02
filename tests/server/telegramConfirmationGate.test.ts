import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import type { OrderIntent } from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { ConfirmationPendingError, TelegramConfirmationGate } from '../../server/telegramConfirmationGate.mts';

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

function intent(id = 'BTCEUR:1:0'): OrderIntent {
  return {
    id,
    createdAt: 1_000,
    mode: 'live',
    symbol: 'BTCEUR',
    side: 'buy',
    quantity: 2,
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    assessment: approvedAssessment(),
  };
}

/** A sell/exit intent closing a position — assessment is the position's
 * ORIGINAL entry assessment (entry: 100), not a fresh proposal. */
function sellIntent(id = 'BTCEUR:1:0:exit', exitPrice = 110): OrderIntent {
  return {
    id,
    createdAt: 2_000,
    mode: 'live',
    symbol: 'BTCEUR',
    side: 'sell',
    quantity: 2,
    limitPrice: exitPrice,
    stopLoss: 95,
    takeProfit: 115,
    assessment: approvedAssessment(),
  };
}

/** Routes the one fetchFn Telegram's client uses across sendMessage /
 * getUpdates / answerCallbackQuery, based on the endpoint in the URL —
 * mirrors how one real bot token talks to all three. */
function fakeTelegram(getUpdatesResponses: { update_id: number; callback_query?: { id: string; data: string } }[][]) {
  let updatesCallIndex = 0;
  const sent: string[] = [];
  const answered: string[] = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    if (url.includes('/sendMessage')) {
      sent.push(JSON.parse(init!.body!).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (url.includes('/getUpdates')) {
      const batch = getUpdatesResponses[updatesCallIndex] ?? [];
      updatesCallIndex++;
      return new Response(JSON.stringify({ ok: true, result: batch }), { status: 200 });
    }
    if (url.includes('/answerCallbackQuery')) {
      answered.push(JSON.parse(init!.body!).callback_query_id);
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected Telegram endpoint: ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, sent, answered };
}

describe('TelegramConfirmationGate (real network I/O — the human safety gate for Stage 6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws immediately, without sending anything, when Telegram credentials are missing', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: '', chatId: '' }, audit);
    await expect(gate.requestConfirmation(intent())).rejects.toThrow(/credentials/);
  });

  it('genuinely retries the send on a later call after a failed Telegram send, instead of silently treating it as already-sent', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);

    // First run: the send itself fails (e.g. rate-limited).
    const failingFetch = (async (url: string) => {
      if (url.includes('/sendMessage')) return new Response('{}', { status: 500 });
      throw new Error(`unexpected Telegram endpoint: ${url}`);
    }) as unknown as typeof fetch;
    const gateRun1 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: failingFetch }, audit);
    await expect(gateRun1.requestConfirmation(intent())).rejects.toThrow(ConfirmationPendingError);
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation']);
    expect(audit.entries()[0]!.detail).toContain('Telegram send failed');

    // A later run must actually attempt to send again — not silently poll
    // for a button tap on a message the human never received.
    const { fetchFn: secondFetch, sent } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: 'confirm:approve:BTCEUR:1:0' } }],
    ]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: secondFetch }, audit);
    const decision = await gateRun2.requestConfirmation(intent());
    expect(sent).toHaveLength(1);
    expect(decision.approved).toBe(true);
  });

  it('sends one Telegram message with approve/reject buttons and resolves approved on a matching tap', async () => {
    const { fetchFn, sent } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: 'confirm:approve:BTCEUR:1:0' } }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);

    const promise = gate.requestConfirmation(intent());
    const decision = await promise;

    expect(decision).toMatchObject({ intentId: 'BTCEUR:1:0', approved: true, decidedBy: 'C' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('BTCEUR');
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation', 'confirmed']);
  });

  it('shows the fixed expiry deadline (clock time + minutes) in the sent message, so the human knows exactly how long they have', async () => {
    vi.setSystemTime(0);
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const promise = gate.requestConfirmation(intent());
    const assertion = expect(promise).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(sent[0]).toContain('20 דקות');
    expect(sent[0]).toContain('בתוקף עד');
  });

  it('renders a sell/exit confirmation with the real P&L against the entry price, not the entry-side risk numbers', async () => {
    const { fetchFn, sent } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: 'confirm:approve:BTCEUR:1:0:exit' } }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);

    await gate.requestConfirmation(sellIntent('BTCEUR:1:0:exit', 110));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('מכירה');
    expect(sent[0]).toContain('סגירת פוזיציה');
    // entry 100, exit 110, qty 2 -> +20.00 P&L.
    expect(sent[0]).toContain('+20.00');
    expect(sent[0]).not.toContain('סיכון');
    expect(sent[0]).not.toContain('חשיפת תיק');
  });

  it('resolves approved: false on a reject tap', async () => {
    const { fetchFn } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: 'confirm:reject:BTCEUR:1:0' } }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const decision = await gate.requestConfirmation(intent());
    expect(decision.approved).toBe(false);
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation', 'rejected']);
  });

  it('ignores a callback tap for a different intent and keeps polling for the right one', async () => {
    const { fetchFn } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb-other', data: 'confirm:approve:SOMETHING-ELSE' } }],
      [{ update_id: 11, callback_query: { id: 'cb1', data: 'confirm:approve:BTCEUR:1:0' } }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const promise = gate.requestConfirmation(intent());
    await vi.runAllTimersAsync();
    const decision = await promise;
    expect(decision.approved).toBe(true);
  });

  it('does not re-send the Telegram message on a resumed call for the same intent (idempotent)', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    // First run: no reply ever arrives — every poll attempt comes back empty.
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const first = fakeTelegram(empty);
    const gateRun1 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: first.fetchFn }, audit);
    const p1 = gateRun1.requestConfirmation(intent());
    const p1Assertion = expect(p1).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await p1Assertion;
    expect(first.sent).toHaveLength(1);

    // Second run (simulating the next scheduled invocation), same store: the
    // pending record already exists, so this must not send a second message.
    const second = fakeTelegram([
      [{ update_id: 20, callback_query: { id: 'cb2', data: 'confirm:approve:BTCEUR:1:0' } }],
    ]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: second.fetchFn }, audit);
    const decision = await gateRun2.requestConfirmation(intent());
    expect(second.sent).toHaveLength(0);
    expect(decision.approved).toBe(true);
  });

  it('auto-expires a resumed call once 20 minutes have passed without a reply, instead of submitting at a stale price', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    vi.setSystemTime(0);
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const first = fakeTelegram(empty);
    const gateRun1 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: first.fetchFn }, audit);
    const p1 = gateRun1.requestConfirmation(intent());
    const p1Assertion = expect(p1).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await p1Assertion;
    expect(first.sent).toHaveLength(1);

    // A later run, 21 minutes on: no re-send, no polling — expired outright.
    vi.setSystemTime(21 * 60 * 1000);
    const second = fakeTelegram([]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: second.fetchFn }, audit);
    const decision = await gateRun2.requestConfirmation(intent());

    expect(decision).toMatchObject({ approved: false, decidedBy: 'system' });
    expect(decision.note).toContain('expired');
    expect(second.sent).toHaveLength(0);
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation', 'rejected']);
  });

  it('does not expire a resumed call still within the pending window', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    vi.setSystemTime(0);
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const first = fakeTelegram(empty);
    const gateRun1 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: first.fetchFn }, audit);
    const p1 = gateRun1.requestConfirmation(intent());
    const p1Assertion = expect(p1).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await p1Assertion;

    // 5 minutes later — well within the 20-minute window: still waits, no re-send.
    vi.setSystemTime(5 * 60 * 1000);
    const second = fakeTelegram([
      [{ update_id: 20, callback_query: { id: 'cb2', data: 'confirm:approve:BTCEUR:1:0' } }],
    ]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: second.fetchFn }, audit);
    const decision = await gateRun2.requestConfirmation(intent());
    expect(second.sent).toHaveLength(0);
    expect(decision.approved).toBe(true);
  });

  it('throws ConfirmationPendingError (never a fabricated decision) if nobody answers in time', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const promise = gate.requestConfirmation(intent());
    const assertion = expect(promise).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(sent).toHaveLength(1);
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation']);
  });
});
