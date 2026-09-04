import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type {
  BrokerAdapter,
  BrokerPosition,
  ConfirmationDecision,
  ConfirmationGate,
  OrderStatusReport,
} from '../../src/core/execution/types';
import type { Candle, Instrument } from '../../src/core/types';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { initLiveCash, liveCash } from '../../server/liveLedger.mts';
import { openLivePositions } from '../../server/liveExitFlow.mts';
import { checkManualBuyRequests, parseBuyCommand } from '../../server/manualBuyCommand.mts';

const XBT: Instrument = { symbol: 'XBTEUR', base: 'XBT', quote: 'EUR' };
const candle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1 });

function fakeSource(price = 100, ok = true): MarketDataSource {
  return {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [XBT] }),
    getCandles: async (symbol) => {
      if (symbol !== 'XBTEUR') return { ok: false, error: `unexpected symbol ${symbol}` };
      if (!ok) return { ok: false, error: 'network error' };
      return { ok: true, value: [candle(price), candle(price)] };
    },
  };
}

function fakeConfirmationGate(outcome: ConfirmationDecision): ConfirmationGate {
  return {
    async requestConfirmation() {
      return outcome;
    },
  };
}

/** intentId always mirrors the real submitted intent.id, never the
 * caller-supplied report.intentId — see liveEntryMirror.test.ts's own
 * fakeBrokerAdapter for why (2026-09-03: intent.id now embeds the pending
 * entry's own queuedAt, so a stale hardcoded id would silently stop
 * matching and recordLiveEntryFill's own intentId check would reject the
 * fill). */
function fakeBrokerAdapter(report: OrderStatusReport): BrokerAdapter {
  return {
    name: 'fake-broker',
    mode: 'live',
    async submit(intent) {
      return { ...report, intentId: intent.id };
    },
    async cancel(): Promise<OrderStatusReport> {
      throw new Error('not used');
    },
    async fetchPositions(): Promise<BrokerPosition[]> {
      return [];
    },
  };
}

function flowParams(report: OrderStatusReport, killSwitch: PersistedKillSwitch, audit: PersistedAuditLog) {
  return {
    confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
    brokerAdapter: fakeBrokerAdapter(report),
    killSwitch,
    audit,
    verifySymbolExists: async () => true,
  };
}

function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
  return (async () =>
    new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
}

describe('parseBuyCommand', () => {
  it('parses a symbol, case-insensitively and uppercased', () => {
    expect(parseBuyCommand('/buy xbteur')).toBe('XBTEUR');
    expect(parseBuyCommand('/BUY XBTEUR')).toBe('XBTEUR');
    expect(parseBuyCommand('  /buy   XBTEUR  ')).toBe('XBTEUR');
  });

  it('returns null for anything else, including /buy with no symbol', () => {
    expect(parseBuyCommand('/buy')).toBeNull();
    expect(parseBuyCommand('hello')).toBeNull();
    expect(parseBuyCommand('/buy XBTEUR now')).toBeNull();
    expect(parseBuyCommand('/sell XBTEUR')).toBeNull();
  });
});

describe('checkManualBuyRequests', () => {
  it('does nothing when there is no /buy command', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const telegram = { token: 'T', chatId: 'C', fetchFn: seedTelegram([]) };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(),
      '1h',
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([]);
  });

  it('builds a fixed 2:1 reward:risk opportunity at the current price and submits a real entry through the full safety chain', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: seedTelegram([{ update_id: 1, message: { text: '/buy XBTEUR', chat: { id: 'C' } } }]),
    };
    // Freshly queued at now=1000 (price available immediately) -> queuedAt=1000.
    const report: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR:1000',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 100,
      detail: 'ok',
    };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(100),
      '1h',
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report }]);
    // A filled manual buy must actually become a tracked live position, same
    // as a signal-approved one (mirrorApprovedEntries is reused, not
    // duplicated) — stop 1.5% below entry, target 3% above (2:1).
    const tracked = openLivePositions(store);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.stopLoss).toBeCloseTo(100 * 0.985, 5);
    expect(tracked[0]!.takeProfit).toBeCloseTo(100 * 1.03, 5);
    expect(liveCash(store)).toBeCloseTo(100 - 0.01 * 100, 5);
  });

  it('keeps a /buy queued across cycles when there is no price data yet, instead of losing it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: seedTelegram([{ update_id: 1, message: { text: '/buy XBTEUR', chat: { id: 'C' } } }]),
    };

    const first = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(100, false), // price fetch fails this cycle
      '1h',
      [XBT],
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(first).toEqual([]);

    // A later cycle, no new Telegram message, but the queued symbol is
    // retried and this time price data is available — the FIRST time
    // mirrorApprovedEntries actually runs for it (no price meant no
    // opportunity, so no live-entry-pending record, on the first call
    // above), so queuedAt is this call's own now=1500.
    const report: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR:1500',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 100,
      detail: 'ok',
    };
    const second = await checkManualBuyRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn: seedTelegram([]) },
      fakeSource(100, true),
      '1h',
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch, audit),
      1500,
    );
    expect(second).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report }]);
  });

  it('stashes back a message that is not a /buy command so other consumers can still find it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: seedTelegram([{ update_id: 1, message: { text: '/pause', chat: { id: 'C' } } }]),
    };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(),
      '1h',
      [XBT],
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([]);
    const unclaimed = store.get<unknown[]>('telegram-unclaimed-messages');
    expect(unclaimed).toHaveLength(1);
  });

  it("replies with a usage hint for a bare /buy with no symbol, instead of silently doing nothing — real incident, 2026-09-04: tapping the '/buy <SYMBOL>' line in a momentum-spike alert only sends the bare '/buy' token (Telegram never includes the argument when you tap a bot-command entity), and this used to vanish with zero feedback", async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const sentTexts: string[] = [];
    const fetchFn = (async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/sendMessage')) {
        sentTexts.push((JSON.parse(init!.body!) as { text: string }).text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ ok: true, result: [{ update_id: 1, message: { text: '/buy', chat: { id: 'C' } } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(),
      '1h',
      [XBT],
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([]);
    expect(sentTexts).toEqual(['❌ /buy צריך סימבול, למשל: /buy USELESSEUR']);
  });

  it('respects the kill switch — no manual buy can bypass it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('test');
    const audit = new PersistedAuditLog(store);
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: seedTelegram([{ update_id: 1, message: { text: '/buy XBTEUR', chat: { id: 'C' } } }]),
    };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(100),
      '1h',
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'blocked-by-kill-switch' }]);
  });

  it("submits a manual /buy even past a portfolio-capacity refusal — every manual /buy is automatically eligible for the 'buy anyway despite the warning' override (David asked for this 2026-09-03)", async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: seedTelegram([{ update_id: 1, message: { text: '/buy XBTEUR', chat: { id: 'C' } } }]),
    };
    const zeroCapacity = {
      maxRiskPerTradePct: 1,
      maxPositionPct: 20,
      maxTotalExposurePct: 60,
      maxOpenPositions: 0, // refuses ANY new entry outright
      maxExposurePerAssetPct: 20,
      dailyLossLimitPct: 3,
      minRewardRisk: 1.5,
      maxRewardRisk: 20,
      minStopDistancePct: 0.25,
    };
    const report: OrderStatusReport = { intentId: 'x', state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' };

    const outcomes = await checkManualBuyRequests(
      store,
      telegram,
      fakeSource(100),
      '1h',
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch, audit),
      1000,
      { riskLimits: zeroCapacity },
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: { ...report, intentId: 'live-entry:XBTEUR:1000' } }]);
    expect(openLivePositions(store)).toHaveLength(1);
  });
});
