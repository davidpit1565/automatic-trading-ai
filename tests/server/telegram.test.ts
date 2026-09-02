/**
 * Telegram notification tests (TDD): message formatting for autopilot
 * trades and graceful no-op when credentials are absent.
 */

import { describe, expect, it } from 'vitest';
import { answerCallbackQuery, buildAllClearMessage, buildCycleMessage, buildDailySummary, buildMoveAlert, buildPeriodReport, buildRiskHaltAlert, buildSafetyAlert, buildStockCycleMessage, buildTestMessage, pollAllTelegramUpdates, readinessLineHe, sendTelegramMessage, stashUnclaimedTelegramUpdates } from '../../server/telegram.mts';
import { assessRealMoneyReadiness, READINESS_THRESHOLDS } from '../../src/core/feedback/realMoneyReadiness';
import { MemoryStore } from '../../src/core/data/storage';

describe('buildStockCycleMessage', () => {
  it('returns null when the cycle opened and closed nothing', () => {
    expect(buildStockCycleMessage({ opened: [], closed: [], timestamp: 0 })).toBeNull();
  });

  it('describes a buy in dollars, distinct from the crypto (euro) message', () => {
    const msg = buildStockCycleMessage({
      timestamp: 0,
      opened: [{ symbol: 'AAPL', quantity: 5, entry: 185.5 }],
      closed: [],
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('AAPL');
    expect(msg).toContain('$185.5');
    expect(msg).not.toContain('€');
    expect(msg).toContain('מניות');
  });

  it('describes a sell with the translated exit reason', () => {
    const msg = buildStockCycleMessage({
      timestamp: 0,
      opened: [],
      closed: [{ symbol: 'TSLA', reason: 'stop-loss', price: 240, pnl: -20 }],
    });
    expect(msg).toContain('TSLA');
    expect(msg).toContain('$240');
    expect(msg).toContain('סטופ-לוס');
  });
});

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
    expect(msg).toContain('הסוכן מחובר');
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

  it('appends a separate USD stocks section when stocks data is provided', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      stocks: {
        equity: 10_500,
        cash: 3_000,
        totalReturnPct: 5,
        realizedPnl: 300,
        unrealizedPnl: -20,
        openedLast24h: 1,
        closedLast24h: 2,
      },
    });
    expect(msg).toContain('מניות');
    expect(msg).toContain('$10,500');
    expect(msg).toContain('+$300');
    expect(msg).toContain('-$20');
    // The crypto section's € figures must still be present too — a stocks
    // section is additive, never a replacement.
    expect(msg).toContain('€10,250');
  });

  it('omits the stocks section entirely when no stocks data is given', () => {
    const msg = buildDailySummary({ ...base, positions: [] });
    expect(msg).not.toContain('מניות');
  });

  it("shows the stocks section's own SPY benchmark line, indented, alongside crypto's BTC one", () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      benchmark: { label: 'ביטקוין', portfolioPct: 3.2, assetPct: 1.1 },
      stocks: {
        equity: 10_500, cash: 3_000, totalReturnPct: 5, realizedPnl: 300, unrealizedPnl: -20,
        openedLast24h: 1, closedLast24h: 2,
        benchmark: { label: 'S&P 500 (SPY)', portfolioPct: 4, assetPct: 6 },
      },
    });
    expect(msg).toContain('🏁 מול ביטקוין');
    expect(msg).toContain('   🏁 מול S&P 500 (SPY)');
    expect(msg).toContain('+4.00%');
    expect(msg).toContain('+6.00%');
    expect(msg).toContain('החזקה פשוטה מובילה'); // 4% < 6% — buy-and-hold leads
  });

  it('omits the stocks benchmark line when not measured yet', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      stocks: {
        equity: 10_500, cash: 3_000, totalReturnPct: 5, realizedPnl: 300, unrealizedPnl: -20,
        openedLast24h: 1, closedLast24h: 2,
      },
    });
    expect(msg).not.toContain('🏁');
  });

  it('reports the long-term investing wallet as "still gathering data" below the meaningful-trades bar', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      stocks: {
        equity: 10_500, cash: 3_000, totalReturnPct: 5, realizedPnl: 300, unrealizedPnl: -20,
        openedLast24h: 1, closedLast24h: 2,
        longTermShadow: {
          key: 'long-term', label: 'Long-term investing', equity: 10_100, returnPct: 1,
          trades: 3, winRatePct: 100, profitFactor: null, openPositions: 1, startedAt: 0,
        },
      },
    });
    expect(msg).toContain('השקעות לטווח ארוך');
    expect(msg).toContain('3/');
    expect(msg).not.toContain('+1.00%');
  });

  it('reports crypto\'s own long-term investing wallet as a top-level section (not nested under stocks)', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      longTermShadow: {
        key: 'long-term', label: 'Long-term investing', equity: 10_900, returnPct: 9,
        trades: 30, winRatePct: 55, profitFactor: 1.4, openPositions: 1, startedAt: 0,
      },
    });
    expect(msg).toContain('🌱 ארנק השקעות לטווח ארוך:');
    expect(msg).toContain('+9.00%');
    expect(msg).toContain('PF 1.40');
    // No leading spaces on the crypto section's line (unlike the stocks one,
    // which is indented as a sub-line of the stocks block).
    expect(msg).not.toContain('   🌱 ארנק השקעות לטווח ארוך:');
  });

  it('omits the crypto long-term wallet line entirely when not provided', () => {
    const msg = buildDailySummary({ ...base, positions: [] });
    expect(msg).not.toContain('🌱');
  });

  it('reports the long-term investing wallet\'s real return once past the meaningful-trades bar', () => {
    const msg = buildDailySummary({
      ...base,
      positions: [],
      stocks: {
        equity: 10_500, cash: 3_000, totalReturnPct: 5, realizedPnl: 300, unrealizedPnl: -20,
        openedLast24h: 1, closedLast24h: 2,
        longTermShadow: {
          key: 'long-term', label: 'Long-term investing', equity: 10_800, returnPct: 8,
          trades: 25, winRatePct: 60, profitFactor: 1.8, openPositions: 2, startedAt: 0,
        },
      },
    });
    expect(msg).toContain('השקעות לטווח ארוך');
    expect(msg).toContain('+8.00%');
    expect(msg).toContain('PF 1.80');
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
      closed: [{ symbol: 'ETH-EUR', reason: 'take-profit', price: 1600, pnl: 50 }],
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
      closed: [{ symbol: 'ETH-EUR', reason: 'stop-loss', price: 1500, pnl: -25 }],
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

describe('buildDailySummary — shadow strategy line', () => {
  const base = {
    equity: 10_250,
    cash: 4_000,
    totalReturnPct: 2.5,
    realizedPnl: 100,
    unrealizedPnl: 150,
    openedLast24h: 0,
    closedLast24h: 0,
    positions: [],
  };

  const standing = (over: Partial<{
    key: string; label: string; returnPct: number; trades: number;
    profitFactor: number | null; winRatePct: number | null; equity: number;
    openPositions: number; startedAt: number;
  }>) => ({
    key: 'x', label: 'X', returnPct: 0, trades: 0, profitFactor: null,
    winRatePct: null, equity: 10_000, openPositions: 0, startedAt: 0,
    ...over,
  });

  it('omits the section entirely when no shadows are passed', () => {
    const msg = buildDailySummary(base);
    expect(msg).not.toContain('בבדיקה');
  });

  it('says data is still being collected when no candidate has enough trades', () => {
    const msg = buildDailySummary({
      ...base,
      shadows: [standing({ key: 'a', trades: 5 }), standing({ key: 'b', trades: 12 })],
    });
    expect(msg).toContain('12/20');
    expect(msg).toContain('מוקדם לדרג');
  });

  it('names the leading candidate once one clears the meaningful-trades bar', () => {
    const msg = buildDailySummary({
      ...base,
      shadows: [
        standing({ key: 'a', label: 'Mean reversion', trades: 24, returnPct: 0.66, profitFactor: 1.58 }),
        standing({ key: 'b', label: 'Breakout', trades: 25, returnPct: -6.98, profitFactor: 0.22 }),
      ],
    });
    expect(msg).toContain('Mean reversion');
    expect(msg).toContain('+0.66%');
    expect(msg).not.toContain('Breakout'); // only the leader is named
  });

  it('excludes a candidate below the bar from the ranking, even if its return looks best', () => {
    const msg = buildDailySummary({
      ...base,
      shadows: [
        standing({ key: 'a', label: 'Lucky streak', trades: 3, returnPct: 50 }),
        standing({ key: 'b', label: 'Steady', trades: 22, returnPct: 1 }),
      ],
    });
    expect(msg).toContain('Steady');
    expect(msg).not.toContain('Lucky streak');
  });

  it('makes clear this is simulated and does not affect the real account', () => {
    const msg = buildDailySummary({ ...base, shadows: [standing({ trades: 25, returnPct: 1 })] });
    expect(msg).toContain('כסף מדומה');
  });
});

describe('sendTelegramMessage with an inline keyboard (confirmation-gate buttons)', () => {
  it('sends the reply_markup and returns the message id from Telegram', async () => {
    const sentReplyMarkups: unknown[] = [];
    const fakeFetch = (async (_url: string, init: { body: string }) => {
      sentReplyMarkups.push((JSON.parse(init.body) as { reply_markup?: unknown }).reply_markup);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendTelegramMessage(
      'confirm?',
      { token: 'T', chatId: 'C', fetchFn: fakeFetch },
      { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] },
    );
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe(42);
    expect(sentReplyMarkups).toEqual([{ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] }]);
  });

  it('omits reply_markup entirely for a plain message (unchanged existing behaviour)', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await sendTelegramMessage('plain', { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(sentBody).not.toHaveProperty('reply_markup');
  });
});

describe('pollAllTelegramUpdates / stashUnclaimedTelegramUpdates (the shared cursor fix, 2026-09-02)', () => {
  it('returns both messages and callbacks from one poll, and advances the shared offset past the highest update_id seen', async () => {
    const store = new MemoryStore();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            { update_id: 5, callback_query: { id: 'cb1', data: 'confirm:approve:X', message: { chat: { id: 'C' } } } },
            { update_id: 6, message: { text: '/sell XBTEUR', chat: { id: 'C' } } },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const result = await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(result.callbacks).toEqual([{ id: 'cb1', data: 'confirm:approve:X' }]);
    expect(result.messages).toEqual([{ updateId: 6, text: '/sell XBTEUR' }]);

    // A later call must not re-fetch the same updates — proves the shared
    // offset (not a per-caller one) actually advanced.
    let sawOffset: string | null = null;
    const capturingFetch = (async (url: string) => {
      sawOffset = new URL(url).searchParams.get('offset');
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: capturingFetch });
    expect(sawOffset).toBe('7');
  });

  it('ignores a message from any chat other than the configured one', async () => {
    const store = new MemoryStore();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [{ update_id: 5, message: { text: '/sell XBTEUR', chat: { id: 'someone-else' } } }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const { messages } = await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(messages).toEqual([]);
  });

  it('ignores a button tap (callback_query) from any chat other than the configured one — a real-money confirmation must never be honored from elsewhere', async () => {
    const store = new MemoryStore();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 5,
              callback_query: { id: 'cb1', data: 'confirm:approve:X', message: { chat: { id: 'someone-else' } } },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const { callbacks } = await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(callbacks).toEqual([]);
  });

  it('returns nothing new and leaves the offset unchanged without credentials, on HTTP failure, or on a network error', async () => {
    const store = new MemoryStore();
    expect(await pollAllTelegramUpdates(store, { token: '', chatId: '' })).toEqual({ messages: [], callbacks: [] });

    const httpFail = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    expect(await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: httpFail })).toEqual({
      messages: [],
      callbacks: [],
    });

    const networkError = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: networkError })).toEqual({
      messages: [],
      callbacks: [],
    });
  });

  it('resurfaces stashed-but-unclaimed updates on a later poll, so a DIFFERENT consumer can still find them', async () => {
    const store = new MemoryStore();
    // Nothing new arrives from Telegram this time...
    const emptyFetch = (async () =>
      new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })) as unknown as typeof fetch;
    // ...but an earlier consumer stashed a /pause message and a callback it
    // didn't act on (e.g. the confirmation gate, not the kill-switch handler).
    stashUnclaimedTelegramUpdates(store, {
      messages: [{ updateId: 9, text: '/pause' }],
      callbacks: [{ id: 'cb9', data: 'confirm:approve:other-order' }],
    });
    const result = await pollAllTelegramUpdates(store, { token: 'T', chatId: 'C', fetchFn: emptyFetch });
    expect(result.messages).toEqual([{ updateId: 9, text: '/pause' }]);
    expect(result.callbacks).toEqual([{ id: 'cb9', data: 'confirm:approve:other-order' }]);
  });
});

describe('answerCallbackQuery', () => {
  it('posts the callback query id and never throws even when the request fails', async () => {
    let posted: string | null = null;
    const fakeFetch = (async (url: string) => {
      posted = url;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await answerCallbackQuery('cb1', { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(posted).toContain('/answerCallbackQuery');

    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(answerCallbackQuery('cb1', { token: 'T', chatId: 'C', fetchFn: throwing })).resolves.toBeUndefined();
  });
});
