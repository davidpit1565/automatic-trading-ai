/**
 * Telegram notification tests (TDD): message formatting for autopilot
 * trades and graceful no-op when credentials are absent.
 */

import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error plain-TS server module run via tsx; imported directly in tests
import { buildCycleMessage, buildDailySummary, buildMoveAlert, buildRiskHaltAlert, buildTestMessage, sendTelegramMessage } from '../../server/telegram.mts';

describe('buildTestMessage', () => {
  it('returns a non-empty confirmation the user can recognise', () => {
    const msg = buildTestMessage();
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('הבוט מחובר');
  });
});

describe('buildRiskHaltAlert', () => {
  it('explains the daily-loss pause in plain Hebrew', () => {
    const msg = buildRiskHaltAlert();
    expect(msg).toContain('גבול ההפסד היומי');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('buildMoveAlert', () => {
  it('reports an up-move with a + sign and up arrow', () => {
    const msg = buildMoveAlert('ADAEUR', 5.24);
    expect(msg).toContain('ADAEUR');
    expect(msg).toContain('+5.2%');
    expect(msg).toContain('עלה');
  });

  it('reports a down-move with a - sign', () => {
    const msg = buildMoveAlert('XRPEUR', -6.1);
    expect(msg).toContain('-6.1%');
    expect(msg).toContain('ירד');
  });
});

describe('buildDailySummary', () => {
  const base = {
    equity: 10_250,
    cash: 4_000,
    totalReturnPct: 2.5,
    realizedPnl: 100,
    unrealizedPnl: 150,
    openedLast24h: 2,
    closedLast24h: 1,
  };

  it('reports equity, trade counts and each open position', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [
        { symbol: 'LINKEUR', marketValue: 2_000, pctOfEquity: 19.5 },
        { symbol: 'ADAEUR', marketValue: 4_250, pctOfEquity: 41.5 },
      ],
    });
    expect(msg).toContain('10,250');
    expect(msg).toContain('LINKEUR');
    expect(msg).toContain('ADAEUR');
    expect(msg).toContain('2'); // opened count
  });

  it('signs profit and loss explicitly', () => {
    const msg = buildDailySummary({ ...base, unrealizedPnl: -75, positions: [] });
    expect(msg).toContain('+€100');
    expect(msg).toContain('-€75');
  });

  it('states plainly when there are no open positions', () => {
    const msg = buildDailySummary({ ...base, positions: [] });
    expect(msg).toContain('אין פוזיציות פתוחות');
  });

  it('adds a reassurance line when there were no trades in 24h', () => {
    const msg = buildDailySummary({ ...base, openedLast24h: 0, closedLast24h: 0, positions: [] });
    expect(msg).toContain('ממתין להזדמנות');
  });

  it('shows the Bitcoin benchmark comparison and who is leading', () => {
    const ahead = buildDailySummary({
      ...base,
      positions: [],
      benchmark: { label: 'ביטקוין', portfolioPct: 3.2, assetPct: 1.1 },
    });
    expect(ahead).toContain('ביטקוין');
    expect(ahead).toContain('+3.20%');
    expect(ahead).toContain('מוביל');

    const behind = buildDailySummary({
      ...base,
      positions: [],
      benchmark: { label: 'ביטקוין', portfolioPct: -1, assetPct: 2 },
    });
    expect(behind).toContain('החזקה פשוטה מובילה');
  });
});

describe('buildCycleMessage', () => {
  it('returns null when the cycle opened and closed nothing', () => {
    expect(buildCycleMessage({ opened: [], closed: [], timestamp: 0 })).toBeNull();
  });

  it('describes a buy with symbol, size and price', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [{ symbol: 'BTC-EUR', quantity: 0.01, entry: 54700 }],
      closed: [],
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('BTC-EUR');
    expect(msg).toContain('54');
    expect(msg).toContain('קנייה');
  });

  it('describes a sell with the exit reason', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [],
      closed: [{ symbol: 'ETH-EUR', reason: 'take-profit', price: 1600 }],
    });
    expect(msg).toContain('ETH-EUR');
    expect(msg).toContain('הגיע ליעד'); // translated take-profit
    expect(msg).toContain('מכירה');
  });

  it('shows confidence and translated reasons on a buy when provided', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [
        {
          symbol: 'ADAEUR',
          quantity: 100,
          entry: 0.5,
          confidence: 42,
          reasons: ['Scanner evidence', 'Trend strength'],
        },
      ],
      closed: [],
    });
    expect(msg).toContain('ביטחון 42%');
    expect(msg).toContain('ראיות טכניות');
    expect(msg).toContain('מגמה חזקה');
  });

  it('combines opens and closes in one message', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [{ symbol: 'BTC-EUR', quantity: 0.01, entry: 54700 }],
      closed: [{ symbol: 'ETH-EUR', reason: 'stop-loss', price: 1500 }],
    });
    expect(msg).toContain('BTC-EUR');
    expect(msg).toContain('ETH-EUR');
  });
});

describe('sendTelegramMessage', () => {
  it('skips (does not throw) when credentials are missing', async () => {
    const result = await sendTelegramMessage('hi', { token: '', chatId: '' });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('credentials');
  });

  it('posts to the Telegram API when configured', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string, init: { body: string }) => {
      calls.push(url);
      const body = JSON.parse(init.body) as { chat_id: string; text: string };
      expect(body.chat_id).toBe('123');
      expect(body.text).toBe('hello');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendTelegramMessage('hello', {
      token: 'TOK',
      chatId: '123',
      fetchFn: fakeFetch,
    });
    expect(result.sent).toBe(true);
    expect(calls[0]).toContain('/botTOK/sendMessage');
  });

  it('reports an error result on HTTP failure instead of throwing', async () => {
    const fakeFetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const result = await sendTelegramMessage('x', { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(result.sent).toBe(false);
  });
});
