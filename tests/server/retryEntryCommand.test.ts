import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type { BrokerAdapter, BrokerPosition, ConfirmationDecision, OrderStatusReport } from '../../src/core/execution/types';
import type { TradeOpportunity } from '../../src/core/signal/signalEngine';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';
import { initLiveCash } from '../../server/liveLedger.mts';
import { openLivePositions } from '../../server/liveExitFlow.mts';
import { mirrorApprovedEntries, readLastDeclinedEntry } from '../../server/liveEntryMirror.mts';
import { RETRY_MAX_AGE_MS, checkRetryRequests, parseRetryCommand, revalidateDeclined } from '../../server/retryEntryCommand.mts';

const XBT: Instrument = { symbol: 'XBTEUR', base: 'XBT', quote: 'EUR' };
const candle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1 });

function opp(confidence = 70): TradeOpportunity {
  return {
    symbol: 'XBTEUR',
    timeframe: '1h',
    direction: 'long',
    levels: { entry: 100, stopLoss: 95, takeProfit: 115, riskReward: 3 },
    confidence,
    confidenceComponents: [],
    explanation: 'test',
    warnings: [],
    basedOn: { score: 70, candleCount: 200 },
  };
}
const source = (price: number | null): MarketDataSource => ({
  name: 'fake',
  getInstruments: async () => ({ ok: true, value: [XBT] }),
  getCandles: async () => (price === null ? { ok: false, error: 'down' } : { ok: true, value: [candle(price), candle(price)] }),
});
const telegramWith = (texts: string[], sent: string[]) => ({
  token: 'T',
  chatId: 'C',
  fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('getUpdates')) {
      return new Response(JSON.stringify({ ok: true, result: texts.map((text, i) => ({ update_id: i + 1, message: { text, chat: { id: 'C' } } })) }), { status: 200 });
    }
    if (init?.body) sent.push(JSON.parse(init.body as string).text);
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as unknown as typeof fetch,
});
const broker = (report: OrderStatusReport): BrokerAdapter => ({
  name: 'b',
  mode: 'live',
  submit: async (intent) => ({ ...report, intentId: intent.id }),
  cancel: async () => {
    throw new Error('unused');
  },
  fetchPositions: async (): Promise<BrokerPosition[]> => [],
});
function flow(decision: ConfirmationDecision, report: OrderStatusReport, store: MemoryStore) {
  return {
    confirmationGate: { requestConfirmation: async () => decision },
    brokerAdapter: broker(report),
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    verifySymbolExists: async () => true,
  };
}
const filled: OrderStatusReport = { intentId: 'x', state: 'filled', filledQuantity: 0.1, avgFillPrice: 100, detail: 'ok' };
const declinedDecision: ConfirmationDecision = { intentId: 'x', approved: false, decidedAt: 1, decidedBy: 'david' };
const approvedDecision: ConfirmationDecision = { intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' };

describe('parseRetryCommand', () => {
  it('accepts /retry and /שוב only', () => {
    expect(parseRetryCommand('/retry')).toBe(true);
    expect(parseRetryCommand('  /RETRY ')).toBe(true);
    expect(parseRetryCommand('/שוב')).toBe(true);
    expect(parseRetryCommand('/retry now')).toBe(false);
    expect(parseRetryCommand('retry')).toBe(false);
    expect(parseRetryCommand('/אשר')).toBe(false);
  });
});

describe('revalidateDeclined', () => {
  const T = 1_000_000;
  it('re-proposes at the current price with the ORIGINAL stop/target and recomputed reward:risk', () => {
    const d = revalidateDeclined(opp(), T, 100.5, T + 60_000);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.opportunity.levels.entry).toBe(100.5);
      expect(d.opportunity.levels.stopLoss).toBe(95);
      expect(d.opportunity.levels.takeProfit).toBe(115);
      expect(d.opportunity.levels.riskReward).toBeCloseTo((115 - 100.5) / (100.5 - 95), 8);
    }
  });
  it('refuses when stopped out, at target, chased, weakened, or too old', () => {
    expect(revalidateDeclined(opp(), T, 94, T).ok).toBe(false);
    expect(revalidateDeclined(opp(), T, 116, T).ok).toBe(false);
    expect(revalidateDeclined(opp(), T, 101.5, T).ok).toBe(false); // >1% above signal
    expect(revalidateDeclined(opp(), T, 97, T).ok).toBe(false); // past halfway to the stop
    expect(revalidateDeclined(opp(), T, 100, T + RETRY_MAX_AGE_MS + 1).ok).toBe(false);
  });
});

describe('declined-entry memory', () => {
  it('records a declined signal entry but not a manual one (confidence 0)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    await mirrorApprovedEntries(store, [opp(0)], [XBT], { XBTEUR: 100 }, flow(declinedDecision, filled, store), 1000);
    expect(readLastDeclinedEntry(store)).toBeNull();
    await mirrorApprovedEntries(store, [opp(70)], [XBT], { XBTEUR: 100 }, flow(declinedDecision, filled, store), 2000);
    expect(readLastDeclinedEntry(store)?.declinedAt).toBe(2000);
  });
});

describe('checkRetryRequests', () => {
  it('does nothing without a /retry', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const sent: string[] = [];
    const out = await checkRetryRequests(store, telegramWith([], sent), source(100), '1h', [XBT], { XBTEUR: 100 }, flow(approvedDecision, filled, store), 5000);
    expect(out).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('says so when nothing was declined', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const sent: string[] = [];
    await checkRetryRequests(store, telegramWith(['/retry'], sent), source(100), '1h', [XBT], { XBTEUR: 100 }, flow(approvedDecision, filled, store), 5000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('אין עסקה');
  });

  it('re-proposes a still-valid declined entry through the full chain (new confirmation) and tracks the fill', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    await mirrorApprovedEntries(store, [opp()], [XBT], { XBTEUR: 100 }, flow(declinedDecision, filled, store), 1000);
    expect(readLastDeclinedEntry(store)).not.toBeNull();
    const sent: string[] = [];
    const out = await checkRetryRequests(store, telegramWith(['/retry'], sent), source(100.2), '1h', [XBT], { XBTEUR: 100.2 }, flow(approvedDecision, filled, store), 5000);
    expect(out.map((o) => o.outcome)).toEqual(['submitted']);
    expect(openLivePositions(store)).toHaveLength(1);
    expect(readLastDeclinedEntry(store)).toBeNull(); // single use
    expect(sent.some((m) => m.includes('עדיין תקפה'))).toBe(true);
  });

  it('refuses and explains when the price ran away, without sending any order', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    await mirrorApprovedEntries(store, [opp()], [XBT], { XBTEUR: 100 }, flow(declinedDecision, filled, store), 1000);
    const sent: string[] = [];
    const out = await checkRetryRequests(store, telegramWith(['/retry'], sent), source(103), '1h', [XBT], { XBTEUR: 103 }, flow(approvedDecision, filled, store), 5000);
    expect(out).toEqual([]);
    expect(openLivePositions(store)).toHaveLength(0);
    expect(sent[0]).toContain('רדיפה');
    expect(readLastDeclinedEntry(store)).not.toBeNull(); // may try again if the price comes back
  });

  it('a second /retry in the same poll cannot double-propose', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    await mirrorApprovedEntries(store, [opp()], [XBT], { XBTEUR: 100 }, flow(declinedDecision, filled, store), 1000);
    const sent: string[] = [];
    const out = await checkRetryRequests(store, telegramWith(['/retry', '/retry'], sent), source(100), '1h', [XBT], { XBTEUR: 100 }, flow(approvedDecision, filled, store), 5000);
    expect(out).toHaveLength(1);
    expect(openLivePositions(store)).toHaveLength(1);
  });
});
