/**
 * Telegram notification tests (TDD): message formatting for autopilot
 * trades and graceful no-op when credentials are absent.
 */

import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error plain-TS server module run via tsx; imported directly in tests
import { buildAllClearMessage, buildCycleMessage, buildDailySummary, buildMoveAlert, buildPeriodReport, buildRiskHaltAlert, buildSafetyAlert, buildTestMessage, readinessLineHe, sendTelegramMessage } from '../../server/telegram.mts';
import { assessRealMoneyReadiness, READINESS_THRESHOLDS } from '../../src/core/feedback/realMoneyReadiness';

describe('buildPeriodReport', () => {
  const base = { title: 'שבועי', equity: 10_200, tradesCount: 0, wins: 0, losses: 0, bestPct: null, worstPct: null };
  it('handles the first report (no prior anchor) and no trades', () => {
    const msg = buildPeriodReport({ ...base, periodReturnPct: null });
    expect(msg).toContain('דו"ח שבועי');
    expect(msg).toContain('מתחילים למדוד');
    expect(msg).toContain('0');
  });
  it('shows period return, trade breakdown and best/worst', () => {
    const msg = buildPeriodReport({
      ...base, title: 'חודשי', periodReturnPct: 4.2, tradesCount: 3, wins: 2, losses: 1, bestPct: 8.5, worstPct: -2.1,
    });
    expect(msg).toContain('דו"ח חודשי');
    expect(msg).toContain('+4.20%');
    expect(msg).toContain('2 ברווח, 1 בהפסד');
    expect(msg).toContain('+8.5%');
  });
});

describe('buildAllClearMessage / buildSafetyAlert', () => {
  it('all-clear confirms protections are active', () => {
    expect(buildAllClearMessage()).toContain('הכל מבוטח');
  });
  it('safety alert includes the problem', () => {
    expect(buildSafetyAlert('מזומן שלילי')).toContain('מזומן שלילי');
  });
});

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

describe('real-money readiness line', () => {
  it('says NOT READY with reasons when the record is thin/negative', () => {
    const readiness = assessRealMoneyReadiness({
      closedTrades: 1,
      profitFactor: null,
      realizedReturnPct: -0.5,
      maxDrawdownPct: 2,
      vsBenchmarkPct: 0.1,
      daysRunning: 3,
    });
    const line = readinessLineHe(readiness);
    expect(line).toContain('❌');
    expect(line).toContain('כסף אמיתי');
    // A real reason is surfaced (still simulated, protecting the money).
    expect(line).toContain('כסף מדומה');
  });

  it('says READY once every threshold passes', () => {
    const readiness = assessRealMoneyReadiness({
      closedTrades: READINESS_THRESHOLDS.minClosedTrades,
      profitFactor: 2,
      realizedReturnPct: 6,
      maxDrawdownPct: 3,
      vsBenchmarkPct: 3,
      daysRunning: 40,
    });
    expect(readinessLineHe(readiness)).toContain('✅');
  });

  it('appears in the daily summary when provided', () => {
    const readiness = assessRealMoneyReadiness({
      closedTrades: 1, profitFactor: null, realizedReturnPct: -0.5,
      maxDrawdownPct: 2, vsBenchmarkPct: 0.1, daysRunning: 3,
    });
    const msg = buildDailySummary({
      equity: 9_954, cash: 5_954, totalReturnPct: -0.46, realizedPnl: -45.57,
      unrealizedPnl: 0, positions: [], openedLast24h: 0, closedLast24h: 0, readiness,
    });
    expect(msg).toContain('מוכנות לכסף אמיתי');
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
