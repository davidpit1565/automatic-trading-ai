import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import type { OrderIntent } from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { ConfirmationPendingError, confirmationToken, TelegramConfirmationGate } from '../../server/telegramConfirmationGate.mts';
import { getSummaryTimezone, pollAllTelegramUpdates, stashUnclaimedTelegramUpdates } from '../../server/telegram.mts';
import { initLiveCash } from '../../server/liveLedger.mts';

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

function intent(id = 'BTCEUR:1:0', overrides: Partial<OrderIntent> = {}): OrderIntent {
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
    ...overrides,
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
  const edited: { messageId: number; text: string; keyboardCleared: boolean }[] = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    if (url.includes('/editMessageText')) {
      const body = JSON.parse(init!.body!);
      edited.push({
        messageId: body.message_id,
        text: body.text,
        keyboardCleared: Array.isArray(body.reply_markup?.inline_keyboard) && body.reply_markup.inline_keyboard.length === 0,
      });
      return new Response('{}', { status: 200 });
    }
    if (url.includes('/sendMessage')) {
      sent.push(JSON.parse(init!.body!).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (url.includes('/getUpdates')) {
      const batch = getUpdatesResponses[updatesCallIndex] ?? [];
      updatesCallIndex++;
      // callback_query is only honored from the configured chat (found in
      // an independent review, 2026-09-02) — every fixture here implicitly
      // comes from chat 'C', so stamp it on rather than repeating it at
      // every call site.
      const stamped = batch.map((u) =>
        u.callback_query ? { ...u, callback_query: { ...u.callback_query, message: { chat: { id: 'C' } } } } : u,
      );
      return new Response(JSON.stringify({ ok: true, result: stamped }), { status: 200 });
    }
    if (url.includes('/answerCallbackQuery')) {
      answered.push(JSON.parse(init!.body!).callback_query_id);
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected Telegram endpoint: ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, sent, answered, edited };
}

describe('TelegramConfirmationGate (real network I/O — the human safety gate for Stage 6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fixed so every test's callback_data token (which embeds sentAt) is
    // predictable; tests that need a later time call vi.setSystemTime again.
    vi.setSystemTime(0);
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
      [{ update_id: 10, callback_query: { id: 'cb1', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
    ]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: secondFetch }, audit);
    const decision = await gateRun2.requestConfirmation(intent());
    expect(sent).toHaveLength(1);
    expect(decision.approved).toBe(true);
  });

  it('sends one Telegram message with approve/reject buttons and resolves approved on a matching tap', async () => {
    const { fetchFn, sent, edited } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
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
    // David asked (2026-09-03) to see a visible sign his tap registered,
    // since answerCallbackQuery alone shows nothing — the original prompt
    // must be edited (buttons stripped) right after the decision.
    expect(edited).toEqual([{ messageId: 1, text: expect.stringContaining('אישרת'), keyboardCleared: true }]);
  });

  // David has near-zero trading background and asked (2026-09-03), mid a
  // real confirmation, for the message itself to explain what the numbers
  // mean rather than having to ask each time.
  it('explains each figure in plain language, not just raw numbers', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const assertion = expect(gate.requestConfirmation(intent())).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    const msg = sent[0]!;
    expect(msg).toContain('מכל הכסף שיש לך בחשבון');
    expect(msg).toContain('מוכר אוטומטית אם המחיר יורד');
    expect(msg).toContain('מוכר אוטומטית אם המחיר עולה');
    expect(msg).toContain('הכי הרבה שאפשר להפסיד');
    expect(msg).toContain('אם זה מצליח, הרווח הפוטנציאלי גדול פי');
  });

  // David asked (2026-09-03): with an existing open position already tying
  // up part of the wallet, he wanted the free-cash before/after shown
  // explicitly alongside the overall wallet % (which was already computed
  // against TOTAL equity, not just free cash — this only adds visibility).
  it('shows real free cash before/after the trade, alongside the already-correct total-wallet %', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    initLiveCash(store, 130); // e.g. 100 tied up in another open position + 30 free
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const assertion = expect(gate.requestConfirmation(intent())).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    const msg = sent[0]!;
    // positionValue is 200 in the shared fixture (approvedAssessment).
    expect(msg).toContain('€130.00 עכשיו');
    expect(msg).toContain('€-70.00 אחרי העסקה');
    expect(msg).toContain('כולל פוזיציות פתוחות אחרות');
  });

  // David asked for this 2026-09-03: a manual "buy anyway" override must
  // actually SHOW the human why the trade was normally refused, not just
  // send a plain confirmation as if nothing were unusual — see
  // liveEntryMirror.mts's allowCapacityOverrideFor.
  it('shows the risk-engine warnings (e.g. a manual capacity override) in the confirmation message', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const overriddenIntent = intent('BTCEUR:1:0', {
      assessment: {
        ...approvedAssessment(),
        warnings: ['manual override: normally refused — maximum open positions reached (5/5)'],
      },
    });
    const assertion = expect(gate.requestConfirmation(overriddenIntent)).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(sent[0]).toContain('שים לב');
    expect(sent[0]).toContain('maximum open positions reached (5/5)');
  });

  it('shows no warnings section at all for a normal (non-overridden) approval', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const assertion = expect(gate.requestConfirmation(intent())).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(sent[0]).not.toContain('שים לב');
  });

  it('never shows a raw 15-decimal quantity float — a real production message that leaked one, 2026-09-03', async () => {
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const assertion = expect(
      gate.requestConfirmation(intent('BTCEUR:1:0', { quantity: 0.0001185722175581053 })),
    ).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(sent[0]).not.toContain('0.0001185722175581053');
    expect(sent[0]).toContain('0.00011857'); // formatQty's rounding for a sub-0.01 quantity
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

  it("shows the deadline in the SAME timezone as the daily digests (getSummaryTimezone), not a second hardcoded clock — real bug, 2026-09-03: this stayed on 'Asia/Jerusalem' even after digests moved to Europe/Brussels for David's trip, so the two disagreed by an hour", async () => {
    const ORIGINAL = process.env['SUMMARY_TIMEZONE'];
    process.env['SUMMARY_TIMEZONE'] = 'America/New_York'; // deliberately far from Asia/Jerusalem
    try {
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

      const deadlineMs = 20 * 60 * 1000; // MAX_PENDING_MS, sentAt 0
      const expected = new Intl.DateTimeFormat('he-IL', {
        timeZone: getSummaryTimezone(),
        hour: '2-digit',
        minute: '2-digit',
      }).format(deadlineMs);
      expect(getSummaryTimezone()).toBe('America/New_York');
      expect(sent[0]).toContain(expected);
    } finally {
      if (ORIGINAL === undefined) delete process.env['SUMMARY_TIMEZONE'];
      else process.env['SUMMARY_TIMEZONE'] = ORIGINAL;
    }
  });

  it('renders a sell/exit confirmation with the real P&L against the entry price, not the entry-side risk numbers', async () => {
    const { fetchFn, sent } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0:exit')}`} }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);

    await gate.requestConfirmation(sellIntent('BTCEUR:1:0:exit', 110));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('מכירה');
    expect(sent[0]).toContain('סגירת פוזיציה');
    // entry 100, exit 110, qty 2 -> +20.00 P&L.
    expect(sent[0]).toContain('+€20.00');
    expect(sent[0]).toContain('ברווח');
    expect(sent[0]).not.toContain('סיכון');
    expect(sent[0]).not.toContain('חשיפת תיק');
  });

  it('keeps callback_data within Telegram\'s 64-byte limit even for a long, realistic exit intent id, and still resolves the tap correctly (real incident, 2026-09-03: the confirmation sendMessage itself failed with HTTP 400 for exactly this shape of intent, so the human never even saw it)', async () => {
    const longId = 'live-entry:XBTEUR:1788446384199:exit:1788476199224'; // 52 chars, the real production id that triggered this
    const token = confirmationToken(0, longId);
    const approveData = `confirm:approve:${token}`;
    expect(Buffer.byteLength(approveData, 'utf8')).toBeLessThanOrEqual(64);

    const { fetchFn, sent } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: approveData } }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const decision = await gate.requestConfirmation(sellIntent(longId, 110));

    expect(decision.approved).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('resolves approved: false on a reject tap', async () => {
    const { fetchFn, edited } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb1', data: `confirm:reject:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
    ]);
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const decision = await gate.requestConfirmation(intent());
    expect(decision.approved).toBe(false);
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation', 'rejected']);
    expect(edited).toEqual([{ messageId: 1, text: expect.stringContaining('דחית'), keyboardCleared: true }]);
  });

  it('ignores a callback tap for a different intent and keeps polling for the right one', async () => {
    const { fetchFn } = fakeTelegram([
      [{ update_id: 10, callback_query: { id: 'cb-other', data: 'confirm:approve:SOMETHING-ELSE' } }],
      [{ update_id: 11, callback_query: { id: 'cb1', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
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
      [{ update_id: 20, callback_query: { id: 'cb2', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
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
    // The original prompt (still showing live buttons at this point) must
    // be edited to reflect the auto-expiry, not left sitting there stale.
    expect(second.edited).toEqual([{ messageId: 1, text: expect.stringContaining('פג'), keyboardCleared: true }]);
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
      [{ update_id: 20, callback_query: { id: 'cb2', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`} }],
    ]);
    const gateRun2 = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: second.fetchFn }, audit);
    const decision = await gateRun2.requestConfirmation(intent());
    expect(second.sent).toHaveLength(0);
    expect(decision.approved).toBe(true);
  });

  it('does not lose an approval tap even when a DIFFERENT Telegram consumer polls first in the same batch (the shared-offset bug this fixes)', async () => {
    // Before 2026-09-02, every consumer (this gate, the manual /sell and
    // /pause commands) tracked its OWN independent Telegram offset and
    // called getUpdates directly — but getUpdates(offset) is a single
    // GLOBAL cursor per bot token, so whichever consumer polled first
    // would permanently discard updates the others hadn't read yet. This
    // proves the fix: a callback_query meant for THIS gate survives being
    // read first by an unrelated consumer (simulated here directly against
    // the shared primitives, since manualSellCommand.mts's own poll would
    // be the real-world other consumer).
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const batchFetch = (async (url: string) => {
      if (url.includes('/getUpdates')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              { update_id: 1, message: { text: '/sell ETHEUR', chat: { id: 'C' } } },
              {
                update_id: 2,
                callback_query: { id: 'cb1', data: `confirm:approve:${confirmationToken(0, 'BTCEUR:1:0')}`, message: { chat: { id: 'C' } } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected Telegram endpoint in this step: ${url}`);
    }) as unknown as typeof fetch;

    // A different consumer (simulating manualSellCommand.mts) polls FIRST,
    // takes only the /sell message it cares about, and must stash back the
    // callback_query it doesn't understand.
    const polledByOtherConsumer = await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: batchFetch });
    expect(polledByOtherConsumer.messages).toEqual([{ updateId: 1, text: '/sell ETHEUR' }]);
    stashUnclaimedTelegramUpdates(store, { messages: [], callbacks: polledByOtherConsumer.callbacks });

    // The confirmation gate, polling afterward with no further Telegram
    // traffic, must still find the approval — it was never actually lost.
    const noMoreUpdates = (async (url: string) => {
      if (url.includes('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      if (url.includes('/answerCallbackQuery')) return new Response('{}', { status: 200 });
      throw new Error(`unexpected Telegram endpoint: ${url}`);
    }) as unknown as typeof fetch;
    const { fetchFn: sendFetch } = fakeTelegram([]);
    const combinedFetch = (async (url: string, init?: { body?: string }) => {
      if (url.includes('/sendMessage')) return sendFetch(url, init);
      return noMoreUpdates(url);
    }) as unknown as typeof fetch;
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn: combinedFetch }, audit);
    const decision = await gate.requestConfirmation(intent());
    expect(decision.approved).toBe(true);
  });

  it('does NOT auto-approve a new confirmation using a stale, unclaimed callback left over from an earlier (already-expired) request for the same symbol — real incident, 2026-09-03', async () => {
    // intent.id is deterministic per symbol ('BTCEUR:1:0' every time), so
    // before the fix the callback_data was `confirm:approve:BTCEUR:1:0`
    // EVERY time too — indistinguishable between two entirely separate
    // confirmation requests. Here a callback with that OLD (pre-fix-shaped,
    // effectively a stale/foreign) data sits unclaimed in the store, as if
    // left over from a tap that arrived after its message had already
    // auto-expired. A brand-new request — created much later, so its own
    // token embeds a different sentAt — must never match it.
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    stashUnclaimedTelegramUpdates(store, {
      messages: [],
      callbacks: [{ id: 'stale-cb', data: 'confirm:approve:BTCEUR:1:0' }],
    });

    vi.setSystemTime(999_000);
    const empty = Array.from({ length: 5 }, () => [] as never[]);
    const { fetchFn, sent } = fakeTelegram(empty);
    const gate = new TelegramConfirmationGate(store, { token: 'T', chatId: 'C', fetchFn }, audit);
    const promise = gate.requestConfirmation(intent());
    const assertion = expect(promise).rejects.toThrow(ConfirmationPendingError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(sent).toHaveLength(1);
    // Never resolved — the stale callback must not have been treated as this
    // request's decision.
    expect(audit.entries().map((e) => e.event)).toEqual(['awaiting-confirmation']);
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
