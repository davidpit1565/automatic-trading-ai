import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { ok } from '../../src/core/types';
import {
  checkDiscoverRequests,
  formatDiscoverMessage,
  parseDiscoverCommand,
} from '../../server/manualDiscoverCommand.mts';
import type { CandidateRow } from '../../src/core/validation/candidateScan';

const T = 1_700_000_000_000;

function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
  return (async () =>
    new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
}

function passingRow(base: string): CandidateRow {
  return {
    symbol: `${base}EUR`,
    base,
    quoteVolume: 1_000_000,
    returnPct: 3.5,
    trades: 8,
    winRatePct: 62.5,
    profitFactor: 1.8,
    passes: true,
  };
}

describe('parseDiscoverCommand', () => {
  it('matches /discover with no argument, returning the default top-N', () => {
    expect(parseDiscoverCommand('/discover')).toBe(20);
    expect(parseDiscoverCommand('/DISCOVER')).toBe(20);
    expect(parseDiscoverCommand('  /discover  ')).toBe(20);
  });

  it('matches /discover N, returning the requested top-N', () => {
    expect(parseDiscoverCommand('/discover 15')).toBe(15);
    expect(parseDiscoverCommand('/discover 40')).toBe(40);
  });

  it('falls back to the default for a non-positive N', () => {
    expect(parseDiscoverCommand('/discover 0')).toBe(20);
  });

  it('rejects anything else', () => {
    expect(parseDiscoverCommand('/discover XBTEUR')).toBeNull();
    expect(parseDiscoverCommand('hello')).toBeNull();
    expect(parseDiscoverCommand('/tip')).toBeNull();
  });
});

describe('formatDiscoverMessage', () => {
  it('lists every passing candidate with its stats', () => {
    const message = formatDiscoverMessage([passingRow('SUI'), { ...passingRow('ARB'), passes: false, trades: 3 }], []);
    expect(message).toContain('SUI');
    expect(message).toContain('+3.50');
    expect(message).toContain('1.80');
    expect(message).not.toContain('ARB');
  });

  it('reports plainly when nothing passed', () => {
    const message = formatDiscoverMessage([{ ...passingRow('ARB'), passes: false }], []);
    expect(message).toContain('אף אחד לא עבר את הרף');
  });

  it('mentions skipped symbols without hiding the result', () => {
    const message = formatDiscoverMessage([passingRow('SUI')], ['BAD/BADEUR (1h: timeout)']);
    expect(message).toContain('1 לא נטענו');
    expect(message).toContain('SUI');
  });
});

describe('checkDiscoverRequests', () => {
  function makeSource(): MarketDataSource {
    return {
      name: 'stub',
      getInstruments: async () => ok([{ symbol: 'QUALEUR', base: 'QUAL', quote: 'EUR' }]),
      getCandles: async (symbol, timeframe) =>
        ok(
          generateSyntheticCandles({
            seed: 1,
            startPrice: 100,
            count: 720,
            timeframe,
            startTimestamp: T - 720 * (timeframe === '4h' ? 4 : 1) * 3_600_000,
            drift: 0.001,
            volatility: 0.004,
          }),
        ),
      getTickers: async () =>
        ok([{ symbol: 'QUALEUR', price: 100, open: 100, high: 101, low: 99, volume: 1000, quoteVolume: 1_000_000 }]),
    };
  }

  it('acknowledges, scans, and reports the result for /discover', async () => {
    const store = new MemoryStore();
    const sent: string[] = [];
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('getUpdates')) {
          return new Response(
            JSON.stringify({ ok: true, result: [{ update_id: 1, message: { text: '/discover', chat: { id: 'C' } } }] }),
            { status: 200 },
          );
        }
        if (url.includes('sendMessage') && init?.body) sent.push(JSON.parse(init.body as string).text);
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    };

    const answered = await checkDiscoverRequests(store, telegram, makeSource());

    expect(answered).toBe(true);
    // One immediate "scanning…" ack, then the actual result.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]).toContain('סורק');
    expect(sent.at(-1)).toContain('QUAL');
  });

  it('replies gracefully when the active source has no batch ticker', async () => {
    const store = new MemoryStore();
    const sent: string[] = [];
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('getUpdates')) {
          return new Response(
            JSON.stringify({ ok: true, result: [{ update_id: 1, message: { text: '/discover', chat: { id: 'C' } } }] }),
            { status: 200 },
          );
        }
        if (url.includes('sendMessage') && init?.body) sent.push(JSON.parse(init.body as string).text);
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    };
    const sourceWithoutTickers: MarketDataSource = {
      name: 'stub-no-tickers',
      getInstruments: async () => ok([]),
      getCandles: async () => ok([]),
    };

    const answered = await checkDiscoverRequests(store, telegram, sourceWithoutTickers);

    expect(answered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('לא ניתן לסרוק');
  });

  it('does nothing, and stashes the message back, for anything else', async () => {
    const store = new MemoryStore();
    const telegram = { token: 'T', chatId: 'C', fetchFn: seedTelegram([{ update_id: 1, message: { text: '/tip', chat: { id: 'C' } } }]) };

    const answered = await checkDiscoverRequests(store, telegram, {
      name: 'stub',
      getInstruments: async () => {
        throw new Error('must not be called');
      },
      getCandles: async () => {
        throw new Error('must not be called');
      },
    });

    expect(answered).toBe(false);
    expect(store.get<unknown[]>('telegram-unclaimed-messages')).toHaveLength(1);
  });
});
